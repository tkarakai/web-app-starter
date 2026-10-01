import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { apps, ciApps, proofContext, writePublicFile, loadState, saveState, secretName, settings, values, type State } from "../deploy-setup/model.ts";
import { HttpError, run, type Run } from "../deploy-setup/io.ts";
import { checkSetup, convexEnv, requiredChecks, ensureBackend, ensureProject, storeSecret, type Request } from "../deploy-setup/providers.ts";
const require = createRequire(import.meta.url);
const { readiness } = require("../../../.github/scripts/platform-deploy-preflight.cjs") as { readiness: (env: Record<string, string>) => { status: string; missing: string[] } };
const state = (): State => ({ schema: 1, repository: "owner/app", branch: "main", prefix: "app", team: "team_test", convexTeam: "123", projects: {}, backends: {} });

test("staging skips only unconfigured automatic pushes, preserves legacy deployments and fails partial/manual setup", () => {
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push" }).status, "skip");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "workflow_dispatch" }).status, "error");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push", VERCEL_TOKEN: "present" }).status, "error");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push", DEPLOY_SETUP_STATE: "configuring", VERCEL_TOKEN: "present" }).status, "error");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push", DEPLOY_SETUP_STATE: "ready" }).status, "skip");
  const complete = Object.fromEntries(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID_WEB_STAGING", "VERCEL_PROJECT_ID_ADMIN_STAGING", "VERCEL_PROJECT_ID_LANDING_STATIC_STAGING", "CONVEX_DEPLOY_KEY"].map(k => [k, "present"]));
  assert.equal(readiness({ ...complete, LANDING_APP: "landing-static" }).status, "ready");
  for (const marker of ["", "configuring", "ready"]) for (const event of ["push", "workflow_dispatch"]) {
    assert.equal(readiness({ ...complete, LANDING_APP: "landing-static", GITHUB_EVENT_NAME: event, DEPLOY_SETUP_STATE: marker }).status, "ready");
    assert.equal(readiness({ VERCEL_TOKEN: "present", GITHUB_EVENT_NAME: event, DEPLOY_SETUP_STATE: marker }).status, "error");
    assert.equal(readiness({ GITHUB_EVENT_NAME: event, DEPLOY_SETUP_STATE: marker }).status, event === "push" ? "skip" : "error");
  }
  assert.deepEqual(readiness(complete).missing, ["VERCEL_PROJECT_ID_LANDING_STAGING"]);
});
test("static-only topology has separate static projects and no Convex browser variable", t => {
  const root = mkdtempSync(path.join(tmpdir(), "deploy-setup-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const app of ["apps/web", "platform/apps/admin", "apps/landing-static"]) { mkdirSync(path.join(root, app), { recursive: true }); writeFileSync(path.join(root, app, "package.json"), "{}"); }
  assert.deepEqual(apps(root), ["web", "admin", "landing-static"]);
  assert.deepEqual([settings("landing-static").framework, settings("landing-static").outputDirectory], [null, "out"]);
  assert.equal(secretName("landing-static", "staging"), "VERCEL_PROJECT_ID_LANDING_STATIC_STAGING");
  const s = state(); for (const app of apps(root)) s.projects[`${app}/staging`] = { id: `prj_${app.replaceAll("-", "")}`, name: `app-${app}`, domain: `${app}.example.com` };
  s.backends.staging = { id: 1, name: "backend", url: "https://backend.convex.cloud" };
  const env = values(s, apps(root), "staging");
  assert(!("NEXT_PUBLIC_CONVEX_SITE_URL" in env.vercel["landing-static"]!));
  assert.equal(env.vercel.web!.LANDING_URL, "https://landing-static.example.com");
  mkdirSync(path.join(root, "apps/landing")); writeFileSync(path.join(root, "apps/landing/package.json"), "{}");
  assert.deepEqual(apps(root), ["web", "admin", "landing"]);
  saveState(root, { ...s, token: "never-save-this" } as State);
  assert(!readFileSync(path.join(root, ".deploy-setup.json"), "utf8").includes("never-save-this"));
  assert.deepEqual(loadState(root), s);
  rmSync(path.join(root, ".deploy-setup.json")); symlinkSync(path.join(root, "apps/web/package.json"), path.join(root, ".deploy-setup.json"));
  assert.throws(() => saveState(root, s), /symlink/);
});
test("project creation is idempotent and cannot repurpose a primary landing project for static", async () => {
  const s = state(); let created = false, writes = 0;
  const request: Request = async <T>(_endpoint: string, method = "GET", body?: unknown): Promise<T> => {
    if (_endpoint.endsWith("/domains")) return { domains: [{ name: "assigned-team.vercel.app" }] } as T;
    if (method === "POST") { writes++; created = true; assert(!JSON.stringify(body).includes("gitRepository")); }
    if (!created) throw new HttpError(404, "fixture");
    return { id: "prj_static", name: "app-landing-static-staging", ...settings("landing-static") } as T;
  };
  await ensureProject(s, "landing-static", "staging", request);
  await ensureProject(s, "landing-static", "staging", request);
  assert.equal(writes, 1);
  assert.equal(s.projects["landing-static/staging"]!.domain, "assigned-team.vercel.app");
  const wrong: Request = async <T>() => ({ id: "prj_old", name: "old", ...settings("landing") }) as T;
  await assert.rejects(() => ensureProject(s, "landing-static", "staging", wrong), /rootDirectory/);
  const denied: Request = async () => { throw new HttpError(403, "fixture"); };
  await assert.rejects(() => ensureProject(s, "landing", "production", denied), /403/);
});
test("Convex creation reuses remote projects after interruption and follows pagination", async () => {
  const s = state(), calls: string[] = [];
  const request: Request = async <T>(endpoint: string, method = "GET"): Promise<T> => {
    calls.push(method + " " + endpoint);
    if (endpoint.includes("list_deployments")) return [{ name: "backend", deploymentUrl: "https://backend.convex.cloud", deploymentType: "prod", isDefault: true }] as T;
    if (endpoint.includes("cursor=")) return { items: [{ id: 7, name: "app-staging" }], pagination: { hasMore: false } } as T;
    return { items: [], pagination: { hasMore: true, nextCursor: "next" } } as T;
  };
  await ensureBackend(s, "staging", request); await ensureBackend(s, "staging", request);
  assert.equal(s.backends.staging!.id, 7); assert(calls.every(c => c.startsWith("GET")));
});
test("credential storage uses stdin; subprocess failures never echo secrets", async () => {
  const calls: unknown[] = [];
  const exec: Run = async (file, args, input) => { calls.push({ file, args, input }); return ""; };
  await storeSecret("owner/app", "CONVEX_DEPLOY_KEY", "secret-sentinel", "staging", exec);
  assert.deepEqual(calls, [{ file: "gh", args: ["secret", "set", "CONVEX_DEPLOY_KEY", "--repo", "owner/app", "--env", "staging"], input: "secret-sentinel" }]);
  await assert.rejects(() => run(process.execPath, ["-e", "process.stdin.on('data', x => {process.stderr.write(x); process.exitCode=1;})"], "secret-sentinel"), error => error instanceof Error && !error.message.includes("secret-sentinel"));
});
test("read-only checks report independent provider failures and never write", async () => {
  const exec: Run = async (file, args) => {
    assert(!args.some(a => ["POST", "PUT", "PATCH", "set", "deploy"].includes(a)));
    if (file === "vercel") throw Error("private provider response");
    return file === "bun" ? "Status: Not logged in" : "authenticated";
  };
  const checks = await checkSetup(undefined, ["web", "admin", "landing"], exec);
  assert.equal(checks.find(c => c.step === "github-login")?.status, "done");
  assert.equal(checks.find(c => c.step === "vercel-login")?.status, "unavailable");
  assert.equal(checks.find(c => c.step === "convex-login")?.status, "missing");
  assert(!JSON.stringify(checks).includes("private provider response"));
});

test("branch setup adds checks without replacing existing review/access policy", async () => {
  const { configureBranch } = await import("../deploy-setup/providers.ts");
  const calls: { args: string[]; body?: Record<string, unknown> }[] = [];
  const exec: Run = async (_file, args, input) => {
    calls.push({ args, body: input ? JSON.parse(input) : undefined });
    if (args.includes("GET")) return JSON.stringify({ required_status_checks: { strict: false, contexts: ["Custom Business Tests"], checks: [{ context: "Custom Business Tests", app_id: 123 }] }, required_pull_request_reviews: { required_approving_review_count: 2 } });
    return "{}";
  };
  await configureBranch(state(), ["web", "admin", "landing-static"], exec);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { strict: false, checks: [{ context: "Custom Business Tests", app_id: 123 }, ...["CI Shared Complete", "CI Storybook Complete", "CI Web Complete", "CI Admin Complete", "CI Landing Static Complete"].map(context => ({ context }))] });
  assert(!JSON.stringify(calls).includes('"restrictions"'));
});

test("interrupted staging proof resumes the same request without duplicate deployment", async () => {
  const { stagingProof } = await import("../deploy-setup/proof.ts");
  const s = state(); let dispatches = 0, watches = 0, verifications = 0, savedBeforeDispatch = false;
  const io = {
    github: async <T>(endpoint: string): Promise<T> => {
      if (endpoint.startsWith("commits/")) return { sha: "a".repeat(40) } as T;
      if (endpoint.startsWith("actions/runs/")) return { conclusion: "success", html_url: "https://github.com/owner/app/actions/runs/42" } as T;
      return { workflow_runs: [{ id: 42, display_title: `Deploy [ops:${s.request!.id}]`, conclusion: "success", html_url: "https://github.com/owner/app/actions/runs/42" }] } as T;
    },
    run: async (_file: string, args: string[]) => { assert(savedBeforeDispatch); assert(args.includes(s.request!.id)); dispatches++; return "{}"; },
    watch: async () => { watches++; if (watches === 1) throw Error("interrupted"); },
    verify: async () => { verifications++; },
    confirm: async () => {}, save: () => { savedBeforeDispatch = Boolean(s.request); }, tell: () => {},
  };
  await assert.rejects(() => stagingProof(s, ["web", "admin", "landing"], io), /interrupted/);
  const original = s.request!.id;
  await stagingProof(s, ["web", "admin", "landing"], io);
  assert.equal(s.request!.id, original); assert.equal(dispatches, 1); assert.equal(s.proof, "42");
  await stagingProof(s, ["web", "admin", "landing"], io);
  assert.equal(dispatches, 1); assert.equal(watches, 2); assert.equal(verifications, 1);
});

test("an interrupted key write cannot create duplicate Convex credentials", async () => {
  const { ensureDeployKey } = await import("../deploy-setup/providers.ts");
  const s = state(); s.backends.staging = { id: 1, name: "backend", url: "https://backend.convex.cloud" };
  let creates = 0, exists = false;
  const request: Request = async <T>(_endpoint: string, method = "GET"): Promise<T> => {
    if (method === "GET") return (exists ? [{ name: "github-owner-app-staging" }] : []) as T;
    creates++; exists = true; return { deployKey: "prod:backend|secret-sentinel" } as T;
  };
  const exec: Run = async (_file, args) => { if (args.includes("list")) return "[]"; throw Error("storage interrupted"); };
  await assert.rejects(() => ensureDeployKey(s, "staging", request, exec), /storage interrupted/);
  await assert.rejects(() => ensureDeployKey(s, "staging", request, exec), /No duplicate key/);
  assert.equal(creates, 1);
});

test("public state writes bypass abandoned temporary files without touching symlink targets", async t => {
  const { writePublicFile, readPublicFile } = await import("../deploy-setup/model.ts");
  const root = mkdtempSync(path.join(tmpdir(), "deploy-files-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "other.txt"), "keep");
  symlinkSync(path.join(root, "other.txt"), path.join(root, "ops.config.json.tmp"));
  writePublicFile(root, "ops.config.json", "changed");
  assert.equal(readFileSync(path.join(root, "ops.config.json"), "utf8"), "changed");
  assert.equal(readFileSync(path.join(root, "other.txt"), "utf8"), "keep");
  symlinkSync(path.join(root, "other.txt"), path.join(root, ".deploy-setup.json"));
  assert.throws(() => readPublicFile(root, ".deploy-setup.json"), /safely open/);
});

test("saved setup cannot map staging and production to the same project", async () => {
  const { validateState } = await import("../deploy-setup/model.ts");
  const s = state();
  s.projects["web/staging"] = { id: "prj_same", name: "web", domain: "web.example.com" };
  s.projects["web/production"] = { ...s.projects["web/staging"] };
  assert.throws(() => validateState(s), /separate Vercel project/);
  s.projects = {};
  s.backends.staging = { id: 1, name: "backend", url: "https://backend.convex.cloud" };
  s.backends.production = { ...s.backends.staging };
  assert.throws(() => validateState(s), /separate Convex projects/);
});

test("new branch protection requires PRs and checks without imposing an extra reviewer on solo apps", async () => {
  const { configureBranch } = await import("../deploy-setup/providers.ts");
  const { CommandError } = await import("../deploy-setup/io.ts");
  let body: Record<string, unknown> | undefined;
  const exec: Run = async (_file, args, input) => {
    if (args.includes("GET")) throw new CommandError("gh", 1, 404);
    body = JSON.parse(input!); return "{}";
  };
  await configureBranch(state(), ["web", "admin", "landing"], exec);
  assert.deepEqual(body?.required_pull_request_reviews, { required_approving_review_count: 0 });
  assert((body?.required_status_checks as { contexts: string[] }).contexts.includes("CI Web Complete"));
});

test("simulated Convex environment consumers use the backend package and clear ambient deployment selection", async () => {
  const calls: string[][] = [];
  const exec: Run = async (_file, args, input, env, cwd) => {
    assert.equal(cwd, path.resolve("packages/backend"));
    assert.deepEqual(env, { CONVEX_DEPLOY_KEY: "", CONVEX_DEPLOYMENT: "" });
    assert.deepEqual(args.slice(-2), ["--deployment-name", "backend"]);
    assert(!args.includes("secret-sentinel"));
    if (args.includes("set")) assert.equal(input, "secret-sentinel");
    calls.push(args); return "";
  };
  for (const args of [["list", "--names-only"], ["get", "SITE_URL"], ["set", "BETTER_AUTH_SECRET"]]) {
    await convexEnv("backend", args, args[0] === "set" ? "secret-sentinel" : undefined, exec);
  }
  assert.equal(calls.length, 3);
  assert.equal(await run(process.execPath, ["-e", "process.stdout.write(process.cwd())"], undefined, undefined, path.resolve("packages/backend")), path.resolve("packages/backend"));
  const s = state(), installed = ["web", "admin", "landing"] as const;
  for (const env of ["staging", "production"] as const) {
    s.backends[env] = { id: env === "staging" ? 1 : 2, name: "backend", url: "https://backend.convex.cloud" };
    for (const app of installed) s.projects[`${app}/${env}`] = { id: `prj_${app}_${env}`, name: app, domain: `${app}.${env}.example.com` };
  }
  let reads = 0;
  const checkExec: Run = async (file, args, input, env, cwd) => {
    if (args.includes("env") && file === "bun") {
      await exec(file, args, input, env, cwd); reads++;
      if (args.includes("list")) return "SITE_URL ADMIN_SITE_URL LANDING_URL BETTER_AUTH_SECRET RESEND_API_KEY EMAIL_FROM";
      return values(s, [...installed], reads <= 4 ? "staging" : "production").convex[args[4] as "SITE_URL"];
    }
    throw Error("unavailable fixture provider");
  };
  const checks = await checkSetup(s, [...installed], checkExec, [...installed]);
  assert.equal(reads, 8);
  assert(checks.filter(c => c.step.startsWith("convex-env-")).every(c => c.status === "done"));
});

test("public atomic writes recover stale files and clean up after a failed rename", t => {
  const root = mkdtempSync(path.join(tmpdir(), "deploy-atomic-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of [".deploy-setup.json", "ops.config.json"]) {
    writeFileSync(path.join(root, `${name}.tmp`), "abandoned");
    writePublicFile(root, name, "first"); writePublicFile(root, name, "second");
    assert.equal(readFileSync(path.join(root, name), "utf8"), "second");
    const files = readdirSync(root).sort();
    assert.throws(() => writePublicFile(root, name, Symbol("invalid data") as unknown as string));
    assert.deepEqual(readdirSync(root).sort(), files);
    assert.equal(readFileSync(path.join(root, name), "utf8"), "second");
    rmSync(path.join(root, name)); mkdirSync(path.join(root, name));
    const before = readdirSync(root).sort();
    assert.throws(() => writePublicFile(root, name, "cannot replace directory"));
    assert.deepEqual(readdirSync(root).sort(), before);
  }
});

test("simulated branch inspection rejects every missing installed-app context", async () => {
  const installed = ciApps(process.cwd());
  const required = requiredChecks(installed);
  for (const representation of ["contexts", "checks"] as const) for (const missing of [undefined, ...required]) {
    const contexts = required.filter(context => context !== missing);
    const exec: Run = async (_file, args) => {
      if (args[1]?.endsWith("/protection")) return JSON.stringify({ required_pull_request_reviews: {},
        required_status_checks: { [representation]: representation === "contexts" ? contexts : contexts.map(context => ({ context, app_id: 123 })) } });
      throw Error("unavailable fixture provider");
    };
    const checks = await checkSetup(state(), apps(process.cwd()), exec);
    assert.equal(checks.find(c => c.step === "branch-protection")?.status, missing ? "missing" : "done");
  }
});

test("simulated staging proof requires authorization after topology, domain or project changes", async () => {
  const { stagingProof } = await import("../deploy-setup/proof.ts");
  for (const change of ["topology", "domain", "project", "backend", "legacy"] as const) {
    const s = state(); let installed: ("web" | "admin" | "landing" | "landing-static")[] = ["web", "admin", "landing"];
    s.projects["web/staging"] = { id: "prj_web", name: "web", domain: "web.example.com" };
    s.request = { id: "old-request", sha: "a".repeat(40), context: proofContext(s, installed) }; s.proof = "42";
    if (change === "topology") installed = ["web", "admin", "landing-static"];
    if (change === "domain") s.projects["web/staging"]!.domain = "new.example.com";
    if (change === "project") s.projects["web/staging"]!.id = "prj_new";
    if (change === "backend") s.backends.staging = { id: 2, name: "new", url: "https://new.convex.cloud" };
    if (change === "legacy") delete s.request.context;
    let allowed = false, dispatches = 0, verifications = 0;
    const io = {
      github: async <T>(endpoint: string): Promise<T> => (endpoint.startsWith("commits/") ? { sha: "b".repeat(40) }
        : { workflow_runs: [{ id: 43, conclusion: "success", display_title: `[ops:${s.request!.id}]`, html_url: "fixture" }] }) as T,
      confirm: async () => { if (!allowed) throw Error("declined"); }, save: () => {}, tell: () => {},
      run: async () => { assert(allowed); dispatches++; return ""; }, watch: async () => {},
      verify: async () => { verifications++; throw Error("not serving"); },
    };
    await assert.rejects(() => stagingProof(s, installed, io), /declined/);
    assert.equal(s.request.id, "old-request"); assert.equal(dispatches, 0);
    allowed = true; await stagingProof(s, installed, io);
    assert.equal(dispatches, 1); assert.equal(s.proof, "43");
    await assert.rejects(() => stagingProof(s, installed, io), /not serving/);
    assert.equal(verifications, 1); assert.equal(dispatches, 1);
  }
});

test("serving verification checks current ops mappings and propagates provider failure", async t => {
  const { verifyServing } = await import("../deploy-setup/proof.ts");
  const root = mkdtempSync(path.join(tmpdir(), "deploy-proof-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const s = state(); s.proof = "42";
  s.projects["web/staging"] = { id: "prj_web", name: "web", domain: "web.example.com" };
  let calls = 0;
  const exec: Run = async (_file, args) => { calls++; assert.deepEqual(args, ["run", "ops", "verify", "--run", "42", "--env", "staging", "--repo", "owner/app", "--json"]); throw Error("not serving"); };
  await assert.rejects(() => verifyServing(s, ["web"], exec, root), /mappings differ/);
  assert.equal(calls, 0);
  writeFileSync(path.join(root, "ops.config.json"), JSON.stringify({ repository: s.repository, teamId: s.team, workflowRef: s.branch, apps: { web: { projects: { staging: s.projects["web/staging"] } } } }));
  await assert.rejects(() => verifyServing(s, ["web"], exec, root), /not serving/);
  assert.equal(calls, 1);
});
