import { afterEach, expect, test } from "bun:test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { YAML, spawn } from "bun";
import { defaultConfig } from "../src/config";
import { OpsService } from "../src/service";
import { parseOptions } from "../src/options";
import type { Api, Deployment } from "../src/types";
const require = createRequire(import.meta.url);
const recordOps = require("../../../../.github/scripts/record-ops.cjs");
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
  return YAML.parse(await readFile(new URL(`../../../../.github/actions/${name}/action.yml`, import.meta.url), "utf8")) as Action;
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
test.each([
  ["push-triggered", ""],
  ["ops-triggered", "fixture-request-42"],
])("%s deployments send valid Vercel metadata and preserve deployment identity", async (_trigger, requestId) => {
  const a = await action("deploy-vercel"), step = a.runs.steps.find(s => s.id === "deploy")!;
  const values: Record<string, string> = {
    "github.repository": "team/repo", "inputs.app": "web", "inputs.logical-environment": "staging",
    "steps.provenance.outputs.built-sha": old, "inputs.expected-hash": "c".repeat(16),
    "inputs.artifact-name": `web-${"c".repeat(16)}`, "inputs.run-id": "40",
    "github.run_id": "42", "github.run_attempt": "2", "inputs.environment": "production",
  };
  const script = step.run!.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`Missing expression fixture: ${key}`);
    return values[key];
  });
  const dir = await mkdtemp(resolve(tmpdir(), "ops-deploy-metadata-"));
  try {
    await mkdir(resolve(dir, ".vercel/output"), { recursive: true });
    await writeFile(resolve(dir, ".vercel/project.json"), "{}");
    await writeFile(resolve(dir, "vercel"), `#!/bin/sh
printf '%s\\n' "$@" > "$DEPLOY_ARGS_FILE"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--meta" ] && [ -z "\${2#*=}" ]; then
    echo "Vercel rejects empty metadata: $2" >&2
    exit 23
  fi
  shift
done
printf '%s\\n' 'https://web-fixture.vercel.app'
`, { mode: 0o755 });
    const proc = spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, VERCEL_TOKEN: "fixture-credential",
        OPS_DEPLOY_SHA: sha, OPS_REQUEST_ID: requestId, DEPLOY_ARGS_FILE: resolve(dir, "args"),
        GITHUB_OUTPUT: resolve(dir, "output"), GITHUB_STEP_SUMMARY: resolve(dir, "summary") }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    const args = (await readFile(resolve(dir, "args"), "utf8")).trim().split("\n");
    for (const value of ["--prebuilt", "--prod", "opsEnvironment=staging", `opsSelectedSha=${sha}`, `opsBuiltSha=${old}`,
      "opsBuildRunId=40", "opsRunId=42", "opsRunAttempt=2", `DEPLOYED_COMMIT=${sha}`]) expect(args).toContain(value);
    expect(args.filter(arg => arg.startsWith("opsRequestId="))).toEqual(requestId ? [`opsRequestId=${requestId}`] : []);
    expect(await readFile(resolve(dir, "output"), "utf8")).toBe("url=https://web-fixture.vercel.app\n");
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
    const workflow = YAML.parse(await readFile(new URL(`../../../../.github/workflows/platform-cd-${kind}.yml`, import.meta.url), "utf8")) as { jobs: Record<string, { if?: string; steps?: Step[] }>; permissions: Record<string, string> };
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
  const w = YAML.parse(await readFile(new URL("../../../../.github/workflows/platform-cd-staging.yml", import.meta.url), "utf8")) as { jobs: Record<string, { needs: string[]; if: string }> };
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
    const workflow = YAML.parse(await readFile(new URL(`../../../../.github/workflows/platform-cd-${kind}.yml`, import.meta.url), "utf8")) as { jobs: { validate: { steps: Step[] } } };
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
async function realTurboHashes(app: "web" | "landing" | "landing-static"): Promise<Record<string, string>> {
  const a = await action("build-app");
  const dir = await mkdtemp(resolve(tmpdir(), "ops-hash-test-"));
  const hashes: Record<string, string> = {};
  const sourceRoot = new URL("../../../..", import.meta.url).pathname;
  const env = { ...process.env };
  for (const name of ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_WEB_APP_URL", "NEXT_PUBLIC_CONVEX_SITE_URL", "CONVEX_URL", "APP_ENVIRONMENT"]) delete env[name];
  try {
    for (const environment of ["staging", "production"]) {
      const file = resolve(dir, `${environment}.env`);
      await writeFile(file, `NEXT_PUBLIC_SITE_URL=https://${environment}.example.com\nNEXT_PUBLIC_WEB_APP_URL=https://web-${environment}.example.com\nNEXT_PUBLIC_CONVEX_SITE_URL=https://backend-${environment}.example.com\nCONVEX_URL=https://backend-${environment}.example.com\nAPP_ENVIRONMENT=${environment}\n`);
      {
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
    return hashes;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test("real Turbo hashes reuse web across environments", async () => {
  const hashes = await realTurboHashes("web"); expect(hashes["web/staging"]).toBe(hashes["web/production"]);
}, 30_000);
const landingHashTest = existsSync(new URL("../../../../apps/landing/package.json", import.meta.url)) ? test : test.skip;
landingHashTest("real Turbo hashes separate optional static landing builds", async () => {
  const hashes = await realTurboHashes("landing"); expect(hashes["landing/staging"]).not.toBe(hashes["landing/production"]);
}, 30_000);


for (const installed of [[], ["landing"], ["landing-static"], ["landing", "landing-static"]]) {
  test(`deployment selects one landing from [${installed.join(",")}]`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "selected-landing-"));
    try {
      await mkdir(resolve(root, ".ops-workflow/.github/scripts"), { recursive: true });
      await writeFile(resolve(root, ".ops-workflow/.github/scripts/platform-landing-app.sh"), await readFile(new URL("../../../../.github/scripts/platform-landing-app.sh", import.meta.url)));
      for (const app of installed) {
        await mkdir(resolve(root, `apps/${app}`), { recursive: true });
        await writeFile(resolve(root, `apps/${app}/package.json`), "{}");
      }
      const selected = installed.includes("landing") ? "landing" : installed[0];
      if (selected) expect(Object.keys(defaultConfig("team/repo", root).apps)).toEqual(["web", "admin", selected]);
      for (const kind of ["staging", "production", "rollback"]) {
        const w = YAML.parse(await readFile(new URL(`../../../../.github/workflows/platform-cd-${kind}.yml`, import.meta.url), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
        const step = w.jobs[kind === "staging" ? "validate-source" : "validate"].steps.find(s => s.id === "present")!;
        const output = resolve(root, "output"); await writeFile(output, "");
        const child = spawn(["bash", "-e", "-c", step.run!], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output }, stdout: "pipe", stderr: "pipe" });
        expect(await child.exited).toBe(selected ? 0 : 1);
        const values = await readFile(output, "utf8");
        if (selected) expect(values).toBe(`landing=true\nlanding-app=${selected}\n`);
        else expect(await new Response(child.stderr).text()).toContain("No landing app is installed");
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
test("static landing records use the selected physical app in every outcome", async () => {
  const f = recordFixture(); process.env.OPS_LANDING_APP = "landing-static";
  await recordOps(f.args);
  expect(f.records).toHaveLength(4);
  expect(f.records[2]).toMatchObject({ payload: { app: "landing-static", landingApp: "landing-static", result: "failure" } });
  for (const r of f.records) expect(r).toMatchObject({ payload: { landingApp: "landing-static" } });
});
const staticHashTest = existsSync(new URL("../../../../apps/landing-static/package.json", import.meta.url)) ? test : test.skip;
staticHashTest("static fallback hashes separate staging and production", async () => {
  const hashes = await realTurboHashes("landing-static");
  expect(hashes["landing-static/staging"]).not.toBe(hashes["landing-static/production"]);
}, 30_000);

test("static builder overrides serverless settings with an exported directory", async () => {
  const a = await action("build-app");
  const step = a.runs.steps.find(s => s.name === "Configure static export builder")!;
  const root = await mkdtemp(resolve(tmpdir(), "static-builder-"));
  try {
    await mkdir(resolve(root, ".vercel"));
    await writeFile(resolve(root, ".vercel/project.json"), JSON.stringify({ projectId: "static-only", settings: { framework: "nextjs", rootDirectory: "apps/landing-static" } }));
    const child = spawn(["bash", "-e", "-c", step.run!], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(JSON.parse(await readFile(resolve(root, ".vercel/project.json"), "utf8"))).toEqual({ projectId: "static-only", settings: {
      framework: null, rootDirectory: "apps/landing-static", buildCommand: "bun run build", outputDirectory: "out",
    } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["landing", "landing-static"])("staging gate requires the selected %s CI and ignores the skipped alternative", async selected => {
  const w = YAML.parse(await readFile(new URL("../../../../.github/workflows/platform-cd-staging.yml", import.meta.url), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  const template = String(w.jobs["ci-gate"].steps[0].with!.script);
  for (const result of ["success", "failure", "skipped"]) {
    const script = template.replaceAll("${{ needs.validate-source.outputs.landing-app }}", selected)
      .replaceAll("${{ needs.ci-landing.result }}", selected === "landing" ? result : "skipped")
      .replaceAll("${{ needs.ci-landing-static.result }}", selected === "landing-static" ? result : "skipped")
      .replace(/\$\{\{ needs\.[\w-]+\.result \}\}/g, "success");
    const statuses: { state: string }[] = [];
    const failures: string[] = [];
    const execute = new Function("github", "context", "core", `return (async () => { ${script} })()`);
    await execute({ rest: { repos: { createCommitStatus: async (status: { state: string }) => statuses.push(status) } } },
      { repo: { owner: "team", repo: "repo" }, serverUrl: "https://github.com", runId: 42 }, { setFailed: (message: string) => failures.push(message) });
    expect(statuses[0].state).toBe(result === "success" ? "success" : "failure");
    expect(failures.length).toBe(result === "success" ? 0 : 1);
  }
});

test.each(["valid", "missing-root", "serverless"])("static artifact packaging handles %s output", async kind => {
  const a = await action("build-app"), step = a.runs.steps.find(s => s.name === "Package artifact")!;
  const dir = await mkdtemp(resolve(tmpdir(), "static-package-"));
  try {
    await mkdir(resolve(dir, ".vercel/output/static"), { recursive: true });
    if (kind !== "missing-root") await writeFile(resolve(dir, ".vercel/output/static/index.html"), "<html>static</html>");
    if (kind === "serverless") {
      await mkdir(resolve(dir, ".vercel/output/functions"));
      await writeFile(resolve(dir, ".vercel/output/functions/function"), "server");
    }
    const expressions: Record<string, string> = { "inputs.app": "landing-static", "steps.meta.outputs.tarball": "landing-static.tar.gz",
      "steps.meta.outputs.checksum-file": "landing-static.tar.gz.sha256", "steps.layout.outputs.app-dir": "apps/landing-static", "inputs.environment": "production" };
    const script = step.run!.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
      if (!(key in expressions)) throw new Error(`Missing expression fixture: ${key}`);
      return expressions[key];
    });
    const child = spawn(["bash", "-e", "-c", script], { cwd: dir, env: { ...process.env, GITHUB_STEP_SUMMARY: resolve(dir, "summary") }, stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(kind === "valid" ? 0 : 1);
    if (kind === "valid") {
      const list = spawn(["tar", "-tzf", "landing-static.tar.gz"], { cwd: dir, stdout: "pipe" });
      const files = await new Response(list.stdout).text();
      expect(await list.exited).toBe(0);
      expect(files).toContain(".vercel/output/static/index.html");
      expect(files).not.toContain(".next");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("all CD paths use distinct static project secrets without falling back to the primary project", async () => {
  for (const kind of ["staging", "production", "rollback"]) {
    const source = await readFile(new URL(`../../../../.github/workflows/platform-cd-${kind}.yml`, import.meta.url), "utf8");
    const expressions = [...source.matchAll(/\$\{\{ (secrets\[[^\n]+?\]) \}\}/g)].map(match => match[1]);
    expect(expressions).toHaveLength(2);
    for (const expression of expressions) {
      const suffix = expression.includes("_STAGING") ? "_STAGING" : "";
      for (const selected of ["landing", "landing-static"]) {
        const code = expression.replace(/(?:needs\.(?:changes|validate)|steps\.present)\.outputs\.landing-app/g, JSON.stringify(selected));
        const evaluate = new Function("secrets", `return ${code};`);
        const secrets = { [`VERCEL_PROJECT_ID_LANDING${suffix}`]: "primary-project", [`VERCEL_PROJECT_ID_LANDING_STATIC${suffix}`]: "static-project" };
        expect(evaluate(secrets)).toBe(selected === "landing-static" ? "static-project" : "primary-project");
        delete secrets[`VERCEL_PROJECT_ID_LANDING_STATIC${suffix}`];
        expect(evaluate(secrets)).toBe(selected === "landing-static" ? undefined : "primary-project");
      }
    }
  }
});

test("standalone landing CI still skips removed apps", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "optional-landing-ci-"));
  try {
    for (const app of ["landing", "landing-static"]) {
      const w = YAML.parse(await readFile(new URL(`../../../../.github/workflows/platform-ci-${app}.yml`, import.meta.url), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
      const step = w.jobs.changes.steps.find(s => s.id === "present")!;
      const output = resolve(root, "output");
      for (const present of [false, true]) {
        if (present) {
          await mkdir(resolve(root, `apps/${app}`), { recursive: true });
          await writeFile(resolve(root, `apps/${app}/package.json`), "{}");
        }
        await writeFile(output, "");
        const child = spawn(["bash", "-e", "-c", step.run!], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output }, stdout: "pipe", stderr: "pipe" });
        expect(await child.exited).toBe(0);
        expect(await readFile(output, "utf8")).toBe(`app=${present}\n`);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["landing", "landing-static"])("staging change evaluation schedules the selected %s only for changed inputs or force", async selected => {
  const w = YAML.parse(await readFile(new URL("../../../../.github/workflows/platform-cd-staging.yml", import.meta.url), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  const step = w.jobs.changes.steps.find(s => s.id === "eval")!;
  const filters = YAML.parse(String(w.jobs.changes.steps.find(s => s.id === "filter")!.with!.filters)) as { landing: string[] };
  for (const path of ["apps/landing/**", "apps/landing-static/**", "platform/packages/i18n/**", "packages/messages/**"]) expect(filters.landing).toContain(path);
  const root = await mkdtemp(resolve(tmpdir(), "landing-changes-"));
  try {
    for (const force of [false, true]) for (const changed of [false, true]) {
      const script = step.run!.replaceAll("${{ needs.validate-source.outputs.landing-app }}", selected)
        .replaceAll("${{ inputs.force_deploy || inputs.git_sha != '' }}", String(force))
        .replaceAll("${{ steps.filter.outputs.landing }}", String(changed))
        .replace(/\$\{\{ steps\.filter\.outputs\.\w+ \}\}/g, "false");
      const output = resolve(root, "output"); await writeFile(output, "");
      const child = spawn(["bash", "-e", "-c", script], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output }, stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(0);
      expect(await readFile(output, "utf8")).toContain(`landing=${force || changed}\n`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["landing", "landing-static"])("failed staging CI followed by a successful rerun preserves %s evidence", async selected => {
  const w = YAML.parse(await readFile(new URL("../../../../.github/workflows/platform-cd-staging.yml", import.meta.url), "utf8")) as {
    jobs: Record<string, { needs: string[]; steps: (Step & { env?: Record<string, string> })[] }>;
  };
  const job = w.jobs["ops-record"];
  const expression = job.steps.find(s => s.name === "Persist app outcomes")!.env!.OPS_LANDING_APP;
  const selectionJob = expression.match(/^\$\{\{ needs\.([a-z-]+)\.outputs\.landing-app \}\}$/)![1];
  const f = recordFixture();
  for (const attempt of [1, 2]) {
    const passed = attempt === 2;
    const outcomes: Record<string, { result: string; outputs: Record<string, string> }> = {
      "validate-source": { result: "success", outputs: { "landing-app": selected } },
      changes: passed ? { result: "success", outputs: { "landing-app": selected, web: "true", admin: "true", landing: "true", backend: "true" } }
        : { result: "skipped", outputs: {} },
    };
    // Only direct dependencies appear in Actions' needs context. CI failure skips
    // changes and deployment jobs; source selection has already succeeded.
    const needs = Object.fromEntries(job.needs.map(name => [name, outcomes[name] ?? { result: passed ? "success" : "skipped", outputs: {} }]));
    process.env.OPS_NEEDS = JSON.stringify(needs);
    process.env.OPS_LANDING_APP = needs[selectionJob]?.outputs["landing-app"] ?? "";
    process.env.GITHUB_RUN_ATTEMPT = String(attempt);
    await recordOps(f.args);
  }
  const records: Deployment[] = f.records.map((record, index) => ({
    id: index + 1, sha: String(record.ref), environment: String(record.environment), task: "ops-record",
    created_at: `2026-09-30T12:0${index < 4 ? 1 : 2}:00Z`, payload: record.payload as Deployment["payload"],
  }));
  const api: Api = {
    async get<T>(path: string): Promise<T> {
      if (path.endsWith(`/commits/${sha}`)) return { sha, commit: { message: "Static landing" } } as T;
      if (path.endsWith("/status")) return { statuses: [{ context: "ci/gate-passed", state: "success" }] } as T;
      if (path.includes("/git/matching-refs/")) return [] as T;
      throw new Error(`Unexpected evidence request: ${path}`);
    },
    async pages<T>(path: string): Promise<T[]> {
      if (path.includes("/deployments?")) return [...records].reverse() as T[];
      throw new Error(`Unexpected evidence list: ${path}`);
    },
    async post<T>(): Promise<T> { throw new Error("Inspection must not write"); },
  };
  const service = new OpsService(defaultConfig("team/repo"), api);
  const inspection = await service.inspect(sha, parseOptions(["inspect", sha, "--to", "staging"]));
  expect(service.errors).toEqual([]);
  expect(inspection.rows?.map(row => row.app)).toEqual(["web", "admin", selected, "backend"]);
  expect(records).toHaveLength(8);
  expect(records.slice(0, 4).every(record => record.payload.result === "skipped" && record.payload.runAttempt === 1)).toBe(true);
  expect(records.slice(4).every(record => record.payload.result === "success" && record.payload.runAttempt === 2)).toBe(true);
  expect(records.every(record => record.payload.landingApp === selected)).toBe(true);
  expect(records.filter(record => record.payload.app === selected)).toHaveLength(2);
});
