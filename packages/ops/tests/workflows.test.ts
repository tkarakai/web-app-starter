import { afterEach, expect, test } from "bun:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { YAML, spawn } from "bun";
const require = createRequire(import.meta.url);
const recordOps = require("../../../.github/scripts/record-ops.cjs");
const sha = "a".repeat(40), old = "b".repeat(40);
const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });
function recordFixture(failApp?: string) {
  const records: Record<string, unknown>[] = [], statuses: Record<string, unknown>[] = [], errors: string[] = [];
  process.env.OPS_SHA = sha; process.env.OPS_ENVIRONMENT = "staging"; process.env.OPS_OPERATION = "deploy"; process.env.OPS_HEALTH_JOB = "smoke-test";
  process.env.GITHUB_RUN_ATTEMPT = "2"; process.env.GITHUB_TRIGGERING_ACTOR = "operator";
  process.env.OPS_NEEDS = JSON.stringify({
    changes: { result: "success", outputs: { web: "true", admin: "false", landing: "true", backend: "true" } },
    "build-web": { result: "success", outputs: { "input-hash": "hash", "artifact-name": "web-hash", "artifact-id": "99", "run-id": "7", reused: "true" } },
    "deploy-web": { result: "success", outputs: { "built-sha": old, checksum: "checksum", "deployment-url": "https://web.vercel.app" } },
    "deploy-admin": { result: "skipped", outputs: {} }, "deploy-landing": { result: "failure", outputs: {} },
    "deploy-convex": { result: "success", outputs: {} }, "smoke-test": { result: "skipped" },
  });
  const github = { rest: { repos: {
    createDeployment: async (input: { payload: { app: string } }) => {
      if (input.payload.app === failApp) throw new Error("GitHub unavailable for " + failApp);
      records.push(input); return { data: { id: records.length } };
    },
    createDeploymentStatus: async (input: Record<string, unknown>) => { statuses.push(input); },
  } } };
  const context = { repo: { owner: "team", repo: "repo" }, runId: 42, actor: "original-actor", serverUrl: "https://github.com" };
  return { args: { github, context, core: { info: () => {}, error: (e: string) => errors.push(e) } }, records, statuses, errors };
}
test("audit records preserve partial deployments, reused provenance, unchanged apps and rerun identity", async () => {
  const f = recordFixture(); await recordOps(f.args);
  expect(f.records).toHaveLength(4);
  expect(f.records[0]).toMatchObject({ ref: sha, auto_merge: false, required_contexts: [], payload: { selectedSha: sha, builtSha: old, artifactId: 99, reused: true, runAttempt: 2, actor: "operator", result: "success", health: "skipped" } });
  expect(f.records[1]).toMatchObject({ payload: { app: "admin", result: "unchanged" } });
  expect(f.records[2]).toMatchObject({ payload: { app: "landing", result: "failure" } });
  expect(f.statuses[0]).toMatchObject({ state: "success", auto_inactive: false });
  expect(f.statuses[2]).toMatchObject({ state: "failure" });
});
test("audit recording attempts every app and fails visibly if any record cannot be persisted", async () => {
  const f = recordFixture("web"); await expect(recordOps(f.args)).rejects.toThrow("Ops records incomplete for: web");
  expect(f.records).toHaveLength(3); expect(f.errors[0]).toContain("GitHub unavailable for web");
});
test("invalid SHAs cannot create misleading audit records", async () => {
  const f = recordFixture(); process.env.OPS_SHA = "main";
  await expect(recordOps(f.args)).rejects.toThrow("invalid selected SHA"); expect(f.records).toHaveLength(0);
});
interface Step { name?: string; id?: string; run?: string; uses?: string; with?: Record<string, unknown>; if?: string }
interface Action { runs: { steps: Step[] } }
async function action(name: string): Promise<Action> {
  return YAML.parse(await readFile(new URL(`../../../.github/actions/${name}/action.yml`, import.meta.url), "utf8")) as Action;
}
test("deployment rejects incomplete or obsolete artifact identity before downloading", async () => {
  const a = await action("deploy-vercel");
  const step = a.runs.steps[0];
  expect(step.name).toBe("Validate deployment artifact identity");
  const valid = { ARTIFACT_APP: "web", ARTIFACT_HASH: "c".repeat(16), ARTIFACT_NAME: `web-${"c".repeat(16)}`,
    ARTIFACT_RUN_ID: "42", DEPLOY_SELECTED_SHA: sha, ARTIFACT_TARBALL: "web.tar.gz", ARTIFACT_CHECKSUM_FILE: "web.tar.gz.sha256" };
  for (const overrides of [{}, { ARTIFACT_HASH: "" }, { ARTIFACT_NAME: `web-${sha}` }, { ARTIFACT_NAME: `web-production-${sha}` },
    { ARTIFACT_RUN_ID: "" }, { DEPLOY_SELECTED_SHA: "" }, { ARTIFACT_TARBALL: "admin.tar.gz" }]) {
    const proc = spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", step.run!], {
      env: { ...process.env, ...valid, ...overrides }, stdout: "pipe", stderr: "pipe",
    });
    expect(await proc.exited).toBe(Object.keys(overrides).length ? 1 : 0);
  }
});
test("artifact provenance always verifies the app and current hash contract", async () => {
  const a = await action("deploy-vercel"), step = a.runs.steps.find(s => s.id === "provenance")!;
  expect(step.if).toBeUndefined();
  const hash = "c".repeat(16), dir = await mkdtemp(resolve(tmpdir(), "ops-manifest-"));
  const script = step.run!.replaceAll("${{ inputs.app }}", "web").replaceAll("${{ inputs.artifact-name }}", `web-${hash}`).replaceAll("${{ inputs.expected-hash }}", hash);
  try {
    for (const overrides of [{}, { app: "admin" }, { input_hash: null }, { input_hash: sha }, { input_hash: "d".repeat(16) }]) {
      await writeFile(resolve(dir, "web-manifest.json"), JSON.stringify({ app: "web", input_hash: hash, git_sha: sha, artifact_checksum: "e".repeat(64), ...overrides }));
      const proc = spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        cwd: dir, env: { ...process.env, GITHUB_OUTPUT: resolve(dir, "output"), GITHUB_STEP_SUMMARY: resolve(dir, "summary") }, stdout: "pipe", stderr: "pipe",
      });
      const code = await proc.exited;
      if (Object.keys(overrides).length) expect(code).not.toBe(0);
      else expect(code).toBe(0);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("artifact lookup API failures stop the build instead of becoming cache misses", async () => {
  const a = await action("build-app");
  const script = a.runs.steps.find(s => s.id === "resolve")!.run!.replace(/\$\{\{[^}]+\}\}/g, "fixture");
  const dir = await mkdtemp(resolve(tmpdir(), "ops-shell-"));
  try {
    await writeFile(resolve(dir, "gh"), '#!/bin/sh\necho "permission denied" >&2\nexit 23\n', { mode: 0o755 });
    const proc = spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: resolve(dir, "output") }, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(23); expect(await new Response(proc.stderr).text()).toContain("permission denied");
    expect(await new Response(proc.stdout).text()).not.toContain("building it");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("artifact lookup uses standalone jq with slurp and reuses the newest unexpired package", async () => {
  const a = await action("build-app");
  const script = a.runs.steps.find(s => s.id === "resolve")!.run!.replace(/\$\{\{[^}]+\}\}/g, "fixture");
  const dir = await mkdtemp(resolve(tmpdir(), "ops-artifact-lookup-"));
  try {
    await writeFile(resolve(dir, "gh"), `#!/bin/sh
case "$*" in *--jq*|*--template*) echo 'slurp cannot be combined with jq' >&2; exit 23;; esac
printf '%s' '[{"artifacts":[{"id":1,"expired":false,"created_at":"2026-09-20","workflow_run":{"id":40}}]},{"artifacts":[{"id":2,"expired":false,"created_at":"2026-09-21","workflow_run":{"id":41}},{"id":3,"expired":true,"created_at":"2026-09-22","workflow_run":{"id":42}}]}]'
`, { mode: 0o755 });
    const proc = spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], { env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: resolve(dir, "output"), GITHUB_STEP_SUMMARY: resolve(dir, "summary"),
    }, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    const output = await readFile(resolve(dir, "output"), "utf8");
    expect(output).toContain("artifact-id=2"); expect(output).toContain("run-id=41"); expect(output).toContain("found=true");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test.each([
  ["empty search", '[{"artifacts":[]}]'],
  ["only expired artifacts", '[{"artifacts":[{"id":3,"expired":true,"created_at":"2026-09-22","workflow_run":{"id":42}}]}]'],
])("artifact lookup builds on %s", async (_name, response) => {
  const a = await action("build-app");
  const script = a.runs.steps.find(s => s.id === "resolve")!.run!.replace(/\$\{\{[^}]+\}\}/g, "fixture");
  const dir = await mkdtemp(resolve(tmpdir(), "ops-artifact-miss-"));
  try {
    await writeFile(resolve(dir, "gh"), `#!/bin/sh
case "$*" in *--jq*|*--template*) echo 'slurp cannot be combined with jq' >&2; exit 23;; esac
printf '%s' "$ARTIFACT_RESPONSE"
`, { mode: 0o755 });
    const proc = spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], { env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, ARTIFACT_RESPONSE: response, GITHUB_OUTPUT: resolve(dir, "output"),
    }, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    expect(await readFile(resolve(dir, "output"), "utf8")).toBe("found=false\nrun-id=fixture\n");
    expect(await new Response(proc.stdout).text()).toContain("No artifact named fixture — building it.");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("hash resolution reads target configuration before looking up reusable bytes", async () => {
  const a = await action("build-app"), steps = a.runs.steps;
  expect(steps.findIndex(s => s.name === "Pull Vercel environment")).toBeLessThan(steps.findIndex(s => s.id === "meta"));
  expect(steps.find(s => s.id === "meta")!.run).toContain('--env-file=".vercel/.env.${{ inputs.environment }}.local"');
  expect(steps.find(s => s.id === "meta")!.run).toContain("git rev-parse HEAD");
});
test("every deployment workflow records failures using workflow-version tooling", async () => {
  for (const kind of ["staging", "production", "rollback"]) {
    const workflow = YAML.parse(await readFile(new URL(`../../../.github/workflows/cd-${kind}.yml`, import.meta.url), "utf8")) as { jobs: Record<string, { if?: string; steps?: Step[] }>; permissions: Record<string, string> };
    expect(workflow.permissions.deployments).toBe("write"); expect(workflow.jobs["ops-record"].if).toBe("always()");
    for (const app of ["web", "admin", "landing"]) {
      const steps = workflow.jobs[`deploy-${app}`].steps!;
      expect(steps.some(s => s.uses === "./.ops-workflow/.github/actions/deploy-vercel")).toBe(true);
      const deploy = steps.find(s => s.uses === "./.ops-workflow/.github/actions/deploy-vercel")!;
      for (const input of ["expected-hash", "run-id", "deployed-commit", "github-token"]) expect(deploy.with?.[input]).toBeTruthy();
      expect(steps.find(s => s.name === "Checkout workflow tooling")?.with?.ref).toBe("${{ github.workflow_sha }}");
    }
  }
});
test("staging success tags depend directly on every deploy and attestation outcome", async () => {
  const w = YAML.parse(await readFile(new URL("../../../.github/workflows/cd-staging.yml", import.meta.url), "utf8")) as { jobs: Record<string, { needs: string[]; if: string }> };
  for (const dependency of ["deploy-web", "deploy-admin", "deploy-landing", "attest", "smoke-test"]) expect(w.jobs.record.needs).toContain(dependency);
  expect(w.jobs.record.if).toContain("!contains(needs.*.result, 'failure')");
});
test("health remains successful when a later tag write fails", async () => {
  const f = recordFixture();
  const needs = JSON.parse(process.env.OPS_NEEDS!); needs["smoke-test"] = { result: "failure", outputs: { health: "success" } };
  process.env.OPS_NEEDS = JSON.stringify(needs); await recordOps(f.args);
  expect(f.records[0]).toMatchObject({ payload: { result: "success", health: "success" } });
});

test("production and rollback workflow gates resolve annotated tags and reject mismatched targets", async () => {
  for (const kind of ["production", "rollback"]) {
    const workflow = YAML.parse(await readFile(new URL(`../../../.github/workflows/cd-${kind}.yml`, import.meta.url), "utf8")) as { jobs: { validate: { steps: Step[] } } };
    const step = workflow.jobs.validate.steps.find(s => typeof s.with?.script === "string" && s.with.script.includes("listMatchingRefs"))!;
    const script = String(step.with!.script).replaceAll("${{ inputs.environment }}", "production");
    const execute = new Function("github", "context", "core", `return (async () => { ${script} })()`);
    process.env.OPS_SELECTED_SHA = sha;
    for (const target of [sha, old]) {
      const failures: string[] = [];
      const github = { paginate: async () => [{ ref: `refs/tags/deploy/staging/${sha}`, object: { type: "tag", sha: "tag-object" } }], rest: { git: {
        listMatchingRefs: () => {}, getTag: async () => ({ data: { object: { type: "commit", sha: target } } }),
      } } };
      await execute(github, { repo: { owner: "team", repo: "repo" } }, { setFailed: (message: string) => failures.push(message) });
      expect(failures.length).toBe(target === sha ? 0 : 1);
    }
  }
});
test("real Turbo hashes reuse web across environments but separate static landing builds", async () => {
  const a = await action("build-app");
  const dir = await mkdtemp(resolve(tmpdir(), "ops-hash-test-"));
  const hashes: Record<string, string> = {};
  const sourceRoot = new URL("../../..", import.meta.url).pathname;
  const env = { ...process.env };
  for (const name of ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_WEB_APP_URL", "NEXT_PUBLIC_CONVEX_SITE_URL", "CONVEX_URL", "APP_ENVIRONMENT"]) delete env[name];
  try {
    for (const environment of ["staging", "production"]) {
      const file = resolve(dir, `${environment}.env`);
      await writeFile(file, `NEXT_PUBLIC_SITE_URL=https://${environment}.example.com\nNEXT_PUBLIC_WEB_APP_URL=https://web-${environment}.example.com\nNEXT_PUBLIC_CONVEX_SITE_URL=https://backend-${environment}.example.com\nCONVEX_URL=https://backend-${environment}.example.com\nAPP_ENVIRONMENT=${environment}\n`);
      for (const app of ["web", "landing"]) {
        const output = resolve(dir, `${app}-${environment}.txt`);
        const script = a.runs.steps.find(s => s.id === "meta")!.run!
          .replace('.vercel/.env.${{ inputs.environment }}.local', file)
          .replaceAll('${{ inputs.app }}', app);
        const proc = spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd: sourceRoot, env: { ...env, GITHUB_OUTPUT: output }, stdout: "pipe", stderr: "pipe" });
        const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
        if (code !== 0) throw new Error(`Hash action failed: ${stderr}`);
        hashes[`${app}/${environment}`] = (await readFile(output, "utf8")).match(/^input-hash=(.+)$/m)![1];
      }
    }
    expect(hashes["web/staging"]).toBe(hashes["web/production"]);
    expect(hashes["landing/staging"]).not.toBe(hashes["landing/production"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30_000);
