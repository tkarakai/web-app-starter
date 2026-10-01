import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { apps, loadState, saveState, secretName, settings, values, type State } from "../deploy-setup/model.ts";
import { HttpError, run, type Run } from "../deploy-setup/io.ts";
import { checkSetup, ensureBackend, ensureProject, storeSecret, type Request } from "../deploy-setup/providers.ts";
const require = createRequire(import.meta.url);
const { readiness } = require("../../../.github/scripts/platform-deploy-preflight.cjs") as { readiness: (env: Record<string, string>) => { status: string; missing: string[] } };
const state = (): State => ({ schema: 1, repository: "owner/app", branch: "main", prefix: "app", team: "team_test", convexTeam: "123", projects: {}, backends: {} });

test("staging skips only unconfigured automatic pushes, preserves legacy deployments and fails partial/manual setup", () => {
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push" }).status, "skip");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "workflow_dispatch" }).status, "error");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push", VERCEL_TOKEN: "present" }).status, "error");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push", DEPLOY_SETUP_STATE: "configuring", VERCEL_TOKEN: "present" }).status, "skip");
  assert.equal(readiness({ GITHUB_EVENT_NAME: "push", DEPLOY_SETUP_STATE: "ready" }).status, "error");
  const complete = Object.fromEntries(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID_WEB_STAGING", "VERCEL_PROJECT_ID_ADMIN_STAGING", "VERCEL_PROJECT_ID_LANDING_STATIC_STAGING", "CONVEX_DEPLOY_KEY"].map(k => [k, "present"]));
  assert.equal(readiness({ ...complete, LANDING_APP: "landing-static" }).status, "ready");
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
  const s = state(); let dispatches = 0, watches = 0, savedBeforeDispatch = false;
  const io = {
    github: async <T>(endpoint: string): Promise<T> => {
      if (endpoint.startsWith("commits/")) return { sha: "a".repeat(40) } as T;
      if (endpoint.startsWith("actions/runs/")) return { conclusion: "success", html_url: "https://github.com/owner/app/actions/runs/42" } as T;
      return { workflow_runs: [{ id: 42, display_title: `Deploy [ops:${s.request!.id}]`, conclusion: "success", html_url: "https://github.com/owner/app/actions/runs/42" }] } as T;
    },
    run: async (_file: string, args: string[]) => { assert(savedBeforeDispatch); assert(args.includes(s.request!.id)); dispatches++; return "{}"; },
    watch: async () => { watches++; if (watches === 1) throw Error("interrupted"); },
    confirm: async () => {}, save: () => { savedBeforeDispatch = Boolean(s.request); }, tell: () => {},
  };
  await assert.rejects(() => stagingProof(s, io), /interrupted/);
  const original = s.request!.id;
  await stagingProof(s, io);
  assert.equal(s.request!.id, original); assert.equal(dispatches, 1); assert.equal(s.proof, "42");
  await stagingProof(s, io);
  assert.equal(dispatches, 1); assert.equal(watches, 2);
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

test("public state writes refuse symlink temporary files and leave their targets untouched", async t => {
  const { writePublicFile, readPublicFile } = await import("../deploy-setup/model.ts");
  const root = mkdtempSync(path.join(tmpdir(), "deploy-files-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "other.txt"), "keep");
  symlinkSync(path.join(root, "other.txt"), path.join(root, "ops.config.json.tmp"));
  assert.throws(() => writePublicFile(root, "ops.config.json", "changed"), /EEXIST/);
  assert.equal(readFileSync(path.join(root, "other.txt"), "utf8"), "keep");
  symlinkSync(path.join(root, "other.txt"), path.join(root, ".deploy-setup.json"));
  assert.throws(() => readPublicFile(root, ".deploy-setup.json"), /safely open/);
});
