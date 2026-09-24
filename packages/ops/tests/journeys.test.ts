import { expect, test } from "bun:test";
import { HttpApi } from "../src/api";
import { defaultConfig, validateConfig } from "../src/config";
import { artifactApp, parallel, resolveTag } from "../src/evidence";
import { OpsError } from "../src/errors";
import { failureStage } from "../src/journeys";
import { parseOptions } from "../src/options";
import { sanitizeLinks } from "../src/output";
import { OpsService } from "../src/service";
import type { Api, Coverage, Deployment, Job, Run } from "../src/types";

const sha = "a".repeat(40), prior = "b".repeat(40), root = "/repos/team/repo";
class Fake implements Api {
  constructor(private handler: (path: string) => unknown) {}
  async get<T>(path: string): Promise<T> { return this.handler(path) as T; }
  async pages<T>(path: string): Promise<T[]> { return this.get<T[]>(path); }
  async post<T>(): Promise<T> { throw new Error("Unexpected write"); }
}
function fixture() {
  const config = defaultConfig("team/repo");
  const run: Run = { id: 42, run_attempt: 1, path: ".github/workflows/cd-staging.yml", name: "Deploy staging", display_title: "deploy", head_sha: sha,
    head_branch: "main", status: "completed", conclusion: "success", created_at: "2026-09-23T12:00:00Z", updated_at: "2026-09-23T12:01:00Z", actor: { login: "ops" }, html_url: "https://github.com/team/repo/actions/runs/42" };
  const records: Deployment[] = ["web", "admin", "landing", "backend"].map((app, i) => ({ id: i + 1, task: "ops-record", environment: "staging", sha, created_at: "2026-09-23T12:01:00Z",
    payload: { schemaVersion: 1, app, selectedSha: sha, result: "success", health: "success", runId: 42, runAttempt: 1, deploymentUrl: `https://${app}.vercel.app`, buildResult: "success" } }));
  const observed = Object.fromEntries(["web", "admin", "landing"].map(app => {
    config.apps[app].projects = { staging: { id: app, domain: `${app}.example.com` }, production: null };
    return [app, { url: `${app}.vercel.app`, readyState: "READY", meta: { opsSelectedSha: sha, opsBuiltSha: prior, opsRunId: "42", opsRunAttempt: "1" } }];
  }));
  const jobs: Job[] = [];
  const gh = new Fake(path => {
    if (path.endsWith("/runs/42")) return run;
    if (path.endsWith("/jobs")) return jobs;
    if (path.includes("/deployments?")) return records;
    if (path.includes("/runs")) return [];
    throw new Error(`Unexpected GitHub read ${path}`);
  });
  const vercel = new Fake(path => {
    const url = new URL(path, "https://example.com");
    if (url.pathname.endsWith("aliases")) { const app = url.searchParams.get("projectId")!; return [{ alias: `${app}.example.com`, deploymentId: app }]; }
    return observed[url.pathname.split("/").at(-1)!];
  });
  const service = new OpsService(config, gh, vercel);
  return { service, run, records, observed, config, jobs };
}
test("serving verification uses the deployment identity, not the reused build SHA", async () => {
  const f = fixture();
  const result = await f.service.verify(42, parseOptions(["verify", "--run", "42"]));
  expect(result.outcome).toBe("serving");
  expect(result.rows?.find(r => r.app === "backend")?.state).toBe("workflow-evidence");
});
test.each(["metadata", "domain", "attempt", "url"])("verification rejects a serving %s mismatch", async kind => {
  const f = fixture();
  if (kind === "metadata") f.observed.web.meta.opsSelectedSha = prior;
  if (kind === "domain") f.observed.web.readyState = "ERROR";
  if (kind === "attempt") f.observed.web.meta.opsRunAttempt = "2";
  if (kind === "url") f.observed.web.url = "manual.vercel.app";
  expect((await f.service.verify(42, parseOptions(["verify", "--run", "42"]))).outcome).toBe("mismatch");
});
test("selective staging verifies unchanged apps against their prior recorded identity", async () => {
  const f = fixture();
  f.records[1].payload.result = "unchanged";
  f.records.push({ ...f.records[1], id: 10, sha: prior, created_at: "2026-09-22T12:00:00Z", payload: { ...f.records[1].payload, selectedSha: prior, result: "success", runId: 41 } });
  f.observed.admin.meta.opsSelectedSha = prior; f.observed.admin.meta.opsRunId = "41";
  const result = await f.service.verify(42, parseOptions(["verify", "--run", "42"]));
  expect(result.outcome).toBe("serving");
  expect(result.rows?.find(r => r.app === "admin")).toMatchObject({ unchanged: true, expectedSha: prior, state: "serving" });
});
test.each(["skipped", "missing-record", "baseline", "conflict", "expected-sha"])("%s evidence cannot become verification success", async kind => {
  const f = fixture();
  if (kind === "skipped") f.config.apps.admin.projects.staging = null;
  if (kind === "missing-record") f.records.pop();
  if (kind === "baseline") f.records[0].payload.result = "unchanged";
  if (kind === "conflict") f.records.push({ ...f.records[0], id: 99 });
  const options = parseOptions(["verify", "--run", "42"]);
  if (kind === "expected-sha") options.expectedSha = prior;
  expect((await f.service.verify(42, options)).outcome).toBe("incomplete");
});
test("failed workflow and successful rerun cannot complete an earlier watched attempt", async () => {
  const f = fixture(); f.run.conclusion = "failure";
  expect((await f.service.verify(42, parseOptions(["verify", "--run", "42"]))).outcome).toBe("workflow-failed");
  f.run.run_attempt = 2; f.run.conclusion = "success";
  await expect(f.service.verify(42, parseOptions(["verify", "--run", "42", "--attempt", "1"]))).rejects.toMatchObject({ code: "RUN_SUPERSEDED" });
});
test("environment selection cannot relabel a run", async () => {
  const f = fixture();
  await expect(f.service.verify(42, parseOptions(["verify", "--run", "42", "--env", "production"]))).rejects.toMatchObject({ code: "ENVIRONMENT_MISMATCH" });
});
test("diagnosis distinguishes record persistence failure from recorded deployment effects", async () => {
  const f = fixture(); f.run.conclusion = "failure";
  f.jobs.push({ id: 1, name: "Record Ops Outcomes", status: "completed", conclusion: "failure", steps: [], started_at: null, completed_at: null, html_url: f.run.html_url });
  const result = await f.service.diagnose(42, parseOptions(["diagnose", "42"]));
  expect(result.rows?.[0].stage).toBe("evidence recording");
  expect(JSON.stringify(result.next)).toContain("already have changed");
  expect((result.effects as { app: string; result: string }[])[0]).toMatchObject({ app: "web", result: "success" });
});
test("migration step failures are distinguished from backend deployment failures", () => {
  expect(failureStage({ name: "Deploy Convex", steps: [{ name: "Run pending migrations", conclusion: "failure" }] } as Job)).toBe("migration");
});
test("partial pagination retains earlier records with explicit coverage", async () => {
  const coverage: Coverage[] = [], errors: unknown[] = [];
  const api = new HttpApi("github", "test", () => {}, async input => new URL(String(input)).searchParams.get("page") === "1"
    ? Response.json(Array.from({ length: 100 }, (_, id) => ({ id }))) : Response.json({ message: "denied" }, { status: 403 }));
  const result = await api.pages("/items", undefined, 200, (c, e) => { coverage.push(c); if (e) errors.push(e); });
  expect(result).toHaveLength(100); expect(coverage[0].state).toBe("partial"); expect(errors).toHaveLength(1);
  await expect(api.pages("/items", undefined, 200)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("repeated GitHub pages stop and report partial coverage", async () => {
  const coverage: Coverage[] = [];
  const api = new HttpApi("github", "test", () => {}, async () => Response.json(Array.from({ length: 100 }, (_, id) => ({ id }))));
  expect(await api.pages("/items", undefined, 300, c => coverage.push(c))).toHaveLength(100);
  expect(coverage[0].state).toBe("partial");
});
test("annotated tags resolve to commits and carry their linked run", async () => {
  const api = new Fake(() => ({ object: { type: "commit", sha }, message: "Workflow run: https://github.com/team/repo/actions/runs/42" }));
  const ref = `refs/tags/deploy/staging/2026-09-23T12-00-00Z/${sha}`;
  expect(await resolveTag(api, root, { ref, object: { type: "tag", sha: prior } })).toMatchObject({ sha, runId: 42 });
  await expect(resolveTag(api, root, { ref, object: { type: "commit", sha: prior } })).rejects.toMatchObject({ code: "TAG_CONFLICT" });
});
test("forged staging evidence cannot authorize a production write", async () => {
  let writes = 0;
  const gh: Api = { get: async <T>(path: string) => (path.includes("matching-refs") ? [{ ref: `refs/tags/deploy/staging/${sha}`, object: { type: "commit", sha: prior } }]
    : path.endsWith("status") ? { statuses: [{ context: "ci/gate-passed", state: "success" }] }
      : { sha, commit: { message: "release" } }) as T,
    pages: async () => [], post: async <T>() => { writes++; return undefined as T; } };
  await expect(new OpsService(defaultConfig("team/repo"), gh).dispatch(sha, parseOptions(["deploy", sha, "--to", "production", "--yes"]))).rejects.toBeInstanceOf(OpsError);
  expect(writes).toBe(0);
});
test("interrupting preflight cannot send a delayed deployment request", async () => {
  const controller = new globalThis.AbortController();
  let writes = 0;
  let finish!: (value: unknown) => void;
  const commit = new Promise(resolve => { finish = resolve; });
  const gh: Api = { get: async <T>() => await commit as T, pages: async () => [], post: async <T>() => { writes++; return undefined as T; } };
  const pending = new OpsService(defaultConfig("team/repo"), gh).dispatch(sha, { ...parseOptions(["deploy", sha, "--to", "staging", "--yes"]), signal: controller.signal });
  controller.abort(); finish({ sha, commit: { message: "release" } });
  await expect(pending).rejects.toMatchObject({ code: "INTERRUPTED" }); expect(writes).toBe(0);
});
test("a serving record survives an unrelated catalog failure as explicitly partial data", async () => {
  const f = fixture();
  const failed = new OpsService(f.config, new Fake(() => { throw new OpsError("FORBIDDEN", "Cannot read GitHub", "Check access"); }), f.service.vercel);
  const result = await failed.status(parseOptions(["status", "--env", "staging"]));
  expect(result.rows).toHaveLength(3); expect(result.rows?.[0].state).toBe("READY"); expect(failed.errors.length).toBeGreaterThan(0);
});
test("artifact recognition handles overlapping app names and excludes report uploads", () => {
  expect(artifactApp(`landing-static-${"a".repeat(16)}`, ["landing", "landing-static"])).toBe("landing-static");
  expect(artifactApp("web-test-results", ["web"])).toBeUndefined();
  for (const app of ["web", "admin", "landing"]) {
    expect(artifactApp(`${app}-e555c7d44ceaca5c`, ["web", "admin", "landing"])).toBe(app);
    for (const suffix of ["aa5014892745663245cb787ffcd5abe88de06331", "production-bcf4ea81aa912ab4fb7eb42506ab0d7788f49fc5",
      "staging-e555c7d44ceaca5c", "preview-e555c7d44ceaca5c", "e555c7d44ceaca5", "e555c7d44ceaca5cf", "e555c7d44ceaca5c-report"]) {
      expect(artifactApp(`${app}-${suffix}`, ["web", "admin", "landing"])).toBeUndefined();
    }
  }
});
test("one project cannot impersonate two environments", () => {
  const config = defaultConfig("team/repo"); config.apps.web.projects = { staging: { id: "same" }, production: { id: "same" } };
  expect(() => validateConfig(config)).toThrow("only be mapped to one");
});
test("provider links drop userinfo and sensitive query strings", () => {
  expect(sanitizeLinks({ rows: [{ url: "https://example.com/run?token=secret#fragment", workflowUrl: "https://user:password@example.com" }] })).toEqual({ rows: [{ url: "https://example.com/run", workflowUrl: null }] });
});
test("detail fanout is bounded and results keep input order", async () => {
  let active = 0, peak = 0;
  expect(await parallel(Array.from({ length: 17 }, (_, i) => i), async n => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 1)); active--; return n; })).toEqual(Array.from({ length: 17 }, (_, i) => i));
  expect(peak).toBeLessThanOrEqual(6);
});
