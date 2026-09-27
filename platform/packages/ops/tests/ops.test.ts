import { describe, expect, test } from "bun:test";
import { HttpApi } from "../src/api";
import { OpsError, errorInfo, registerSecret } from "../src/errors";
import { parseOptions } from "../src/options";
import { defaultConfig, validateConfig } from "../src/config";
import { OpsService } from "../src/service";
import { envelope, safeCell } from "../src/output";
import type { Api, Artifact, Config, Deployment, Run } from "../src/types";

const sha = "a".repeat(40), old = "b".repeat(40);
const base = "/repos/team/repo";
const config = (): Config => ({ ...defaultConfig("team/repo"), teamId: "team_test" });
const options = (args: string[]) => parseOptions(args);
class FakeApi implements Api {
  calls: { path: string; body?: unknown }[] = [];
  constructor(readonly handler: (path: string, body?: unknown) => unknown | Promise<unknown>) {}
  async get<T>(path: string): Promise<T> { this.calls.push({ path }); return await this.handler(path) as T; }
  async post<T>(path: string, body: unknown): Promise<T> { this.calls.push({ path, body }); return await this.handler(path, body) as T; }
  async pages<T>(path: string, _key?: string, _limit?: number): Promise<T[]> { return this.get<T[]>(path); }
}
function fixture(path: string): unknown {
  if (path.includes("/actions/runs?") || path.includes("/actions/workflows/")) return [];
  if (path === `${base}/commits/${sha}` || path === `${base}/commits/aaaaaaa`) return { sha, commit: { message: "Fix invitations", author: { date: "2026-09-23T12:00:00Z" } }, html_url: "https://github.com/team/repo/commit/" + sha };
  if (path.includes("/git/matching-refs/")) return [{ ref: `refs/tags/deploy/staging/2026-09-23T12-00-00Z/${sha}`, object: { type: "commit", sha } }];
  if (path.endsWith("/status")) return { statuses: [{ context: "ci/gate-passed", state: "success" }] };
  if (path.includes("/deployments?")) return [{ id: 1, sha, environment: "staging", created_at: "2026-09-23T12:00:00Z", payload: { schemaVersion: 1, selectedSha: sha, app: "web", artifactName: "web-cccccccccccccccc", artifactId: 99, inputHash: "cccccccccccccccc", builtSha: old, runId: 42, runAttempt: 1, result: "success", health: "success" } }];
  if (path.includes("/actions/artifacts")) return [{ id: 99, name: "web-cccccccccccccccc", expired: false, expires_at: "2099-01-01T00:00:00Z", created_at: "2026-09-23T11:00:00Z", workflow_run: { id: 40, head_sha: old } }];
  throw new Error(`Unexpected fixture request ${path}`);
}

describe("HTTP errors, credentials and pagination", () => {
  test("retries reads visibly, but never duplicates writes", async () => {
    const logs: string[] = []; let calls = 0;
    const read = new HttpApi("github", "test-token", s => logs.push(s), async () => { calls++; return calls < 3 ? Response.json({ message: "unavailable" }, { status: 503 }) : Response.json({ ok: true }); }, async () => {});
    expect(await read.get<{ ok: boolean }>("/test")).toEqual({ ok: true }); expect(calls).toBe(3); expect(logs.filter(s => s.includes("retry"))).toHaveLength(2);
    calls = 0;
    const write = new HttpApi("github", "test-token", () => {}, async () => { calls++; throw new Error("socket reset"); }, async () => {});
    await expect(write.post("/dispatch", {})).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" }); expect(calls).toBe(1);
  });
  test.each([401, 403, 404, 429])("reports HTTP %i with context and remediation", async status => {
    const api = new HttpApi("github", "private-secret", () => {}, async () => Response.json({ message: "Denied private-secret" }, { status, headers: { "retry-after": "60", "x-github-request-id": "req-1" } }));
    try { await api.get("/private"); throw new Error("must fail"); }
    catch (error) { const info = errorInfo(error); expect(info.message).not.toContain("private-secret"); expect(info.details.status).toBe(status); expect(info.details.requestId).toBe("req-1"); expect(info.hint.length).toBeGreaterThan(10); }
  });
  test("rejects credential exfiltration, malformed responses and malformed collections", async () => {
    let calls = 0;
    const api = new HttpApi("vercel", "token", () => {}, async () => { calls++; return new Response("not json"); });
    await expect(api.get("https://evil.example/a")).rejects.toMatchObject({ code: "INVALID_URL" }); expect(calls).toBe(0);
    await expect(api.get("/test")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const broken = new HttpApi("github", "token", () => {}, async () => Response.json({}));
    await expect(broken.pages("/test", "artifacts")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  test("paginates GitHub within the requested bound", async () => {
    const urls: URL[] = [];
    const api = new HttpApi("github", "token", () => {}, async input => {
      const url = new URL(String(input)); urls.push(url);
      const n = Number(url.searchParams.get("per_page"));
      return Response.json({ artifacts: Array.from({ length: n }, (_, i) => ({ id: (urls.length - 1) * 100 + i })) });
    });
    const entries = await api.pages<{ id: number }>("/artifacts?name=web-a", "artifacts", 125);
    expect(entries).toHaveLength(125); expect(new Set(entries.map(e => e.id)).size).toBe(125); expect(entries[124].id).toBe(124);
    expect(urls.map(u => u.searchParams.get("per_page"))).toEqual(["100", "100"]);
    expect(urls[1].searchParams.get("name")).toBe("web-a");
  });
  test("follows Vercel cursors and detects repeated cursors", async () => {
    let calls = 0;
    const api = new HttpApi("vercel", "token", () => {}, async () => { calls++; return Response.json({ deployments: [{ id: calls }], pagination: { next: 10 } }); });
    await expect(api.pages("/deployments", "deployments")).rejects.toMatchObject({ code: "PAGINATION" }); expect(calls).toBe(2);
  });
});

describe("operator and agent contracts", () => {
  for (const argv of [["deploy", sha, "--yes=false"], ["runs", "--limit", "NaN"], ["watch", "abc"], ["status", "--bogus"], ["inspect"], ["history", "--since", "bad"]]) {
    test(`rejects invalid arguments ${argv.join(" ")}`, () => { expect(() => parseOptions(argv)).toThrow(OpsError); });
  }
  test("supports defaults, equals flags and strict config validation", () => {
    expect(options([]).command).toBe("status"); expect(options(["runs", "--limit=5", "--json"]).limit).toBe(5);
    expect(() => validateConfig({ ...config(), repository: "bad" })).toThrow();
    expect(() => validateConfig({ ...config(), apps: { web: { projects: { staging: { id: "p", domain: "https://x" } } } } })).toThrow();
  });
  test("JSON preserves error semantics and terminal output cannot inject controls", () => {
    registerSecret("very-private");
    const out = envelope("status", { rows: [] }, [new OpsError("FORBIDDEN", "denied", "check permissions")]);
    expect(out).toMatchObject({ schemaVersion: 1, ok: false, partial: true });
    expect(safeCell("hello\x1b[2J\nvery-private")).not.toContain("\x1b");
    expect(safeCell("very-private")).toBe("[REDACTED]");
  });
});

describe("release selection and dispatch", () => {
  test("report-only staging runs prove no app artifacts; scoped lookup also finds packages beyond the repository window", async () => {
    const producer = "9cb2a49a1e82545af891e18d6304196405b30422", reportsOnly = "0ba386a1ac6e104fd4a1549f7ba3561a29d5fcaf";
    const api = new FakeApi(path => {
      if (path === base) return { default_branch: "main" };
      if (path.includes("/commits?")) return [reportsOnly, producer].map(s => ({ sha: s, commit: { message: "Commit", author: { date: "2026-09-23T12:00:00Z" } } }));
      if (path.includes("/deployments?") || path.endsWith("/actions/artifacts")) return [];
      if (path.includes("/actions/workflows/")) {
        const s = path.includes(reportsOnly) ? reportsOnly : producer;
        return [{ id: s === reportsOnly ? 43 : 42, head_sha: s, event: "push", path: ".github/workflows/cd-staging.yml", status: "completed" }];
      }
      if (path.endsWith("/artifacts")) return (path.includes("/43/") ? ["coverage-report-web", "playwright-report-admin", "blob-report-web-1"]
        : ["web-e555c7d44ceaca5c", "admin-215a2e8e3660ea0b", "landing-dc28be976c3e62ff"]).map((name, id) => ({ id, name, expired: false, created_at: "2026-09-23T12:00:00Z", expires_at: "2099-01-01T00:00:00Z" }));
      return fixture(path);
    });
    const service = new OpsService(config(), api);
    const all = await service.candidates(options(["candidates", "--to", "staging", "--all-commits"]));
    expect(all.rows).toHaveLength(2);
    expect(all.rows?.[0]).toMatchObject({ sha: reportsOnly, hasProducedArtifacts: false, artifactSummary: "no current-format app artifacts",
      appEvidence: [{ app: "web", artifactState: "none" }, { app: "admin", artifactState: "none" }, { app: "landing", artifactState: "none" }, { app: "backend" }] });
    expect(all.rows?.[1]).toMatchObject({ sha: producer, hasProducedArtifacts: true, artifactSummary: "artifacts: web/admin/landing" });
    const selected = await service.candidates(options(["candidates", "--to", "staging"]));
    expect(selected.rows?.map(r => r.sha)).toEqual([producer]); expect(selected.hiddenWithoutProducedArtifacts).toBe(1);
    expect(service.errors).toHaveLength(0);
  });
  test.each(["in_progress", "failed-lookup", "windowed", "partial"])("%s artifact evidence cannot establish that none were produced", async mode => {
    const api = new FakeApi(path => {
      if (path.includes("/actions/workflows/")) return [{ id: 42, head_sha: sha, event: "push", path: ".github/workflows/cd-staging.yml", status: mode === "in_progress" ? mode : "completed" }];
      if (mode === "failed-lookup") throw new OpsError("FORBIDDEN", "Cannot list artifacts", "Check access");
      return [];
    });
    if (mode === "windowed" || mode === "partial") {
      const original = api.pages.bind(api);
      (api as Api).pages = async <T>(path: string, key?: string, limit?: number, report?: import("../src/types").PageReport) => {
        const entries = await original<T>(path, key, limit);
        report?.({ source: path, state: path.endsWith("/artifacts") ? mode : "complete", count: entries.length });
        return entries;
      };
    }
    const evidence = await new OpsService(config(), api).candidateUploadEvidence(sha);
    expect(evidence.complete).toBe(false); expect(evidence.sources).toEqual([]);
  });
  test("pre-record staging push artifacts appear once per commit with all app packages", async () => {
    const artifacts: Artifact[] = ["web", "admin", "landing"].map((app, i) => ({ id: i + 1, name: `${app}-${"c".repeat(16)}`, expired: false,
      expires_at: "2099-01-01T00:00:00Z", created_at: "2026-09-23T12:00:00Z", size_in_bytes: 100, workflow_run: { id: 42, head_sha: sha } }));
    const api = new FakeApi(path => {
      if (path === base) return { default_branch: "main" };
      if (path.includes("/commits?")) return [fixture(`${base}/commits/${sha}`)];
      if (path.includes("/deployments?")) return [];
      if (path.endsWith("/actions/artifacts")) return artifacts;
      if (path.endsWith("/actions/runs/42")) return { id: 42, head_sha: sha, event: "push", path: ".github/workflows/cd-staging.yml" };
      return fixture(path);
    });
    const service = new OpsService(config(), api);
    const result = await service.candidates(options(["candidates", "--to", "staging"]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows?.[0]).toMatchObject({ sha, artifactSummary: "artifacts: web/admin/landing", noAppChanges: false, evidenceRun: null });
    expect(result.rows?.[0].appEvidence).toMatchObject([...artifacts.map((a, i) => ({ app: ["web", "admin", "landing"][i], result: "unknown",
      artifactState: "uploaded", artifactId: a.id, artifactSource: "staging-push-run", artifactRun: 42,
      url: `https://github.com/team/repo/actions/runs/42/artifacts/${a.id}` })), { app: "backend", result: "unknown", artifactState: "source" }]);
    expect(api.calls.filter(c => c.path.endsWith("/actions/runs/42"))).toHaveLength(1);
    expect(service.errors).toHaveLength(0);
  });
  test("artifact fallback rejects ambiguous workflow heads, reports, expiry and commits outside the list", async () => {
    const artifact = (id: number, overrides: Partial<Artifact> = {}): Artifact => ({ id, name: `web-${"c".repeat(16)}`, expired: false,
      expires_at: "2099-01-01T00:00:00Z", created_at: "2026-09-23T12:00:00Z", size_in_bytes: 100, workflow_run: { id, head_sha: sha }, ...overrides });
    const api = new FakeApi(path => {
      const id = Number(path.split("/").at(-1));
      return { id, head_sha: id === 3 ? old : sha, event: id === 1 ? "workflow_dispatch" : "push",
        path: id === 2 ? ".github/workflows/ci-web.yml" : ".github/workflows/cd-staging.yml" };
    });
    const service = new OpsService(config(), api);
    const sources = await service.candidateArtifactSources([
      artifact(1), artifact(2), artifact(3), artifact(4, { name: "web-coverage" }), artifact(5, { expired: true }),
      artifact(6, { expires_at: "2000-01-01T00:00:00Z" }), artifact(7, { workflow_run: { id: 7, head_sha: old } }),
    ], [sha]);
    expect(sources).toEqual([]); expect(api.calls).toHaveLength(3);
  });
  test("unreadable artifact source runs require opting in to unknown candidates", async () => {
    const service = new OpsService(config(), new FakeApi(path => {
      if (path === base) return { default_branch: "main" };
      if (path.includes("/commits?")) return [fixture(`${base}/commits/${sha}`)];
      if (path.includes("/deployments?")) return [];
      if (path.endsWith("/actions/artifacts")) return [{ id: 1, name: `web-${"c".repeat(16)}`, expired: false,
        expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: 42, head_sha: sha } }];
      if (path.endsWith("/actions/runs/42") || path.includes("/actions/workflows/")) throw new OpsError("FORBIDDEN", "Cannot read run", "Check access");
      return fixture(path);
    }));
    const result = await service.candidates(options(["candidates", "--to", "staging"]));
    expect(result).toMatchObject({ rows: [], hiddenWithoutProducedArtifacts: 1 });
    expect(service.errors).toHaveLength(2);
    const all = await service.candidates(options(["candidates", "--to", "staging", "--all-commits"]));
    expect(all.rows).toMatchObject([{ sha, noAppChanges: false, hasAvailableArtifacts: false, artifactSummary: "artifact availability unknown" }]);
  });
  test("staging candidates use unique default-branch commits and the overall gate, not workflow heads or individual successes", async () => {
    const commit = (sha: string, message: string) => ({ sha, commit: { message, author: { date: "2026-09-23T12:00:00Z" } }, html_url: `https://github.com/team/repo/commit/${sha}` });
    const api = new FakeApi(path => {
      if (path === base) return { default_branch: "release/main" };
      if (path.includes("/deployments?") || path.endsWith("/actions/artifacts") || path.includes("/actions/workflows/")) return [];
      if (path === `${base}/commits?sha=release%2Fmain`) return [commit(sha, "Fix invitations\n\nDetails"), commit(sha, "Duplicate page record"), commit(old, "Earlier change")];
      if (path === `${base}/commits/${sha}/status`) return { statuses: [{ context: "Security", state: "success" }, { context: "ci/gate-passed", state: "failure" }] };
      if (path === `${base}/commits/${old}/status`) return { statuses: [{ context: "Security", state: "success" }] };
      throw new Error(`Unexpected ${path}`);
    });
    const service = new OpsService({ ...config(), workflowRef: "workflow-code-only" }, api);
    const result = await service.candidates(options(["candidates", "--to", "staging", "--all-commits"]));
    expect(result).toMatchObject({ sourceBranch: "release/main", target: "staging", rows: [
      { sha, change: "Fix invitations", ci: "failure" }, { sha: old, change: "Earlier change", ci: "unknown" },
    ] });
    expect(result.rows).toHaveLength(2); expect(service.errors).toHaveLength(0);
    expect(api.calls.filter(c => c.path.endsWith("/status"))).toHaveLength(2);
    expect(api.calls.some(c => c.path.includes("/actions/runs") || c.body)).toBe(false);
  });
  test("a CI lookup failure preserves the commit without claiming it passed", async () => {
    const service = new OpsService(config(), new FakeApi(path => {
      if (path === base) return { default_branch: "main" };
      if (path.includes("/deployments?") || path.endsWith("/actions/artifacts") || path.includes("/actions/workflows/")) return [];
      if (path.includes("/commits?")) return [fixture(`${base}/commits/${sha}`)];
      throw new OpsError("FORBIDDEN", "Cannot read CI", "Check access");
    }));
    const result = await service.candidates(options(["candidates", "--to", "staging", "--all-commits"]));
    expect(result.rows).toMatchObject([{ sha, ci: "unavailable" }]); expect(service.errors).toHaveLength(1);
  });
  test("distinguishes selected SHA from reused build SHA using target-environment evidence", async () => {
    const service = new OpsService(config(), new FakeApi(fixture));
    const result = await service.inspect("aaaaaaa", options(["inspect", "aaaaaaa", "--to", "staging"]));
    expect(result.eligible).toBe(true); expect(result.sha).toBe(sha);
    expect(result.rows?.find(r => r.app === "web")).toMatchObject({ action: "reuse-recorded-artifact", builtFrom: old });
    expect(result.rows?.find(r => r.app === "landing")).toMatchObject({ action: "resolve-at-deploy" });
  });
  test("an unavailable artifact lookup does not become a claim that a rebuild is required", async () => {
    const service = new OpsService(config(), new FakeApi(path => {
      if (path.includes("/actions/artifacts")) throw new OpsError("FORBIDDEN", "Cannot read artifacts", "Check access");
      return fixture(path);
    }));
    const result = await service.inspect(sha, options(["inspect", sha, "--to", "staging"]));
    expect(result.rows?.[0].action).toBe("resolve-at-deploy"); expect(service.errors).toHaveLength(1);
  });
  for (const app of ["web", "admin", "landing"]) {
    test(`${app} remains unresolved without a recorded target hash, regardless of staging artifacts`, async () => {
      const api = new FakeApi(path => path.includes("/deployments?")
        ? (fixture(path) as Deployment[]).map(r => ({ ...r, payload: { ...r.payload, app, artifactName: `${app}-cccccccccccccccc` } }))
        : fixture(path));
      const service = new OpsService(config(), api);
      const result = await service.inspect(sha, options(["inspect", sha, "--to", "production"]));
      expect(result.rows?.find(r => r.app === app)).toMatchObject({ action: "resolve-at-deploy", artifact: null, inputHash: null });
      expect(api.calls.some(c => c.path.includes("/artifacts"))).toBe(false);
    });
  }
  test("uses the recorded target hash even when newer evidence from another environment differs", async () => {
    const api = new FakeApi(path => {
      if (path.includes("/deployments?")) {
        const record = (fixture(path) as Deployment[])[0];
        return [
          { ...record, payload: { ...record.payload, inputHash: "different", artifactName: "web-different" } },
          { ...record, environment: "production" },
        ];
      }
      return fixture(path);
    });
    const result = await new OpsService(config(), api).inspect(sha, options(["inspect", sha]));
    expect(result.rows?.find(r => r.app === "web")).toMatchObject({ action: "reuse-recorded-artifact", inputHash: "cccccccccccccccc", artifact: "web-cccccccccccccccc", builtFrom: old });
    expect(api.calls.filter(c => c.path.includes("/artifacts")).map(c => c.path)).toEqual([`${base}/actions/artifacts?name=web-cccccccccccccccc`]);
  });
  test("target records without input hashes do not establish artifact reuse", async () => {
    const api = new FakeApi(path => path.includes("/deployments?")
      ? (fixture(path) as Deployment[]).map(r => ({ ...r, environment: "production", payload: { ...r.payload, inputHash: undefined } }))
      : fixture(path));
    const result = await new OpsService(config(), api).inspect(sha, options(["inspect", sha]));
    expect(result.rows?.[0].action).toBe("resolve-at-deploy");
  });
  test("expired bytes require a build while CI failure blocks eligibility", async () => {
    const api = new FakeApi(path => path.includes("/artifacts") ? [{ expired: true, name: "web-cccccccccccccccc", expires_at: "2000-01-01" }] : path.endsWith("/status") ? { statuses: [{ context: "ci/gate-passed", state: "failure" }] } : path.includes("/deployments?") ? (fixture(path) as Deployment[]).map(r => ({ ...r, environment: "production" })) : fixture(path));
    const service = new OpsService(config(), api);
    const result = await service.inspect(sha, options(["inspect", sha]));
    expect(result.eligible).toBe(false); expect(result.rows?.[0].action).toBe("build-required");
    await expect(service.dispatch(sha, options(["deploy", sha, "--to", "production", "--yes"]))).rejects.toMatchObject({ code: "INELIGIBLE" });
    expect(api.calls.every(c => c.body === undefined)).toBe(true);
  });
  test("dry-run sends no write; dispatch requires explicit authorization", async () => {
    const api = new FakeApi(fixture), service = new OpsService(config(), api);
    const result = await service.dispatch(sha, options(["deploy", sha, "--to", "production", "--dry-run"]));
    expect(result.dispatched).toBe(false); expect(api.calls.every(c => c.body === undefined)).toBe(true);
    await expect(service.dispatch(sha, options(["deploy", sha, "--to", "production", "--json"]))).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  });
  test("dispatch carries full SHA and correlation ID; follows the exact run", async () => {
    let body: { inputs: { request_id: string } } | undefined;
    const api = new FakeApi((path, data) => {
      if (data) { body = data as typeof body; return undefined; }
      if (path.includes("/runs?")) return [{ id: 8, display_title: "unrelated run" }, { id: 9, display_title: `Deploy [ops:${body?.inputs.request_id}]` }];
      return fixture(path);
    });
    const service = new OpsService(config(), api);
    const dispatched = await service.dispatch("aaaaaaa", options(["deploy", "aaaaaaa", "--to", "staging", "--yes"]));
    expect(dispatched).toMatchObject({ sha, dispatched: true, workflow: "cd-staging.yml" });
    expect(body).toMatchObject({ ref: "main", inputs: { git_sha: sha, force_deploy: "true" } });
    expect((await service.findDispatchedRun("cd-staging.yml", String(dispatched.requestId)))?.id).toBe(9);
  });
  test("rollback requires exact deployment evidence and preserves target environment", async () => {
    const api = new FakeApi((path, body) => body ? undefined : fixture(path));
    const service = new OpsService(config(), api);
    await service.dispatch(sha, options(["rollback", sha, "--to", "staging", "--yes"]));
    expect(api.calls.at(-1)?.body).toMatchObject({ inputs: { target_sha: sha, environment: "staging", confirm: "rollback-staging" } });
    const missing = new OpsService(config(), new FakeApi(path => path.includes("matching-refs") ? [] : fixture(path)));
    await expect(missing.dispatch(sha, options(["rollback", sha, "--to", "production", "--yes"]))).rejects.toMatchObject({ code: "INELIGIBLE" });
  });
});

describe("actual environment state and active CI", () => {
  test("domain targets determine live state; newer deployments do not replace them", async () => {
    const c = config(); c.apps.web.projects.staging = { id: "p1", domain: "staging.example.com" };
    const vercel = new FakeApi(path => path.includes("/aliases?") ? [{ alias: "staging.example.com", deploymentId: "d1" }] : { id: "d1", readyState: "READY", url: "old.vercel.app", meta: { opsSelectedSha: sha, opsBuiltSha: old } });
    const service = new OpsService(c, new FakeApi(fixture), vercel);
    const state = await service.status(options(["status", "--env", "staging", "--app", "web"]));
    expect(state.rows?.[0]).toMatchObject({ deployedSha: sha, builtFrom: old, deploymentId: "d1", health: "not-probed" });
  });
  test("API failure yields explicit partial results, not empty/success state", async () => {
    const c = config(); c.apps.web.projects.staging = { id: "p1" };
    const service = new OpsService(c, new FakeApi(fixture), new FakeApi(() => { throw new OpsError("FORBIDDEN", "denied", "check access"); }));
    const state = await service.status(options(["status", "--env", "staging"]));
    expect(state.rows?.[0].state).toBe("query-failed"); expect(state.rows).toHaveLength(1);
    expect(service.errors.map(errorInfo).map(e => e.code)).toEqual(["CONFIG_MISSING", "FORBIDDEN"]);
    expect(errorInfo(service.errors[0]).details.missingProjectMappings).toEqual(["admin/staging", "landing/staging"]);
  });
  test("missing mappings report one setup error without querying Vercel or fabricating deployment rows", async () => {
    const vercel = new FakeApi(() => { throw new Error("Vercel must not be queried without mappings"); });
    const service = new OpsService(config(), new FakeApi(fixture), vercel, "team-ops.json");
    const state = await service.status(options(["status"]));
    expect(state.rows).toEqual([]); expect(state.activity).toEqual([]);
    expect(vercel.calls).toHaveLength(0); expect(service.errors).toHaveLength(1);
    const error = errorInfo(service.errors[0]);
    expect(error.code).toBe("CONFIG_MISSING"); expect(error.message).toContain("Configuration missing");
    expect(error.details.configPath).toBe("team-ops.json");
    expect(error.details.missingProjectMappings).toHaveLength(6);
    expect(error.hint).toContain("ops.config.example.json"); expect(error.hint).toContain("VERCEL_TOKEN");
    expect(error.hint).toContain("bun run ops projects");
  });
  test("missing mappings outside the requested app/environment do not cause errors", async () => {
    const c = config(); c.apps.web.projects.staging = { id: "p1" };
    const service = new OpsService(c, new FakeApi(fixture), new FakeApi(() => []));
    await service.status(options(["status", "--app", "web", "--env", "staging"]));
    expect(service.errors).toEqual([]);
  });
  test("missing deployment metadata stays unknown and split domains stay visible", async () => {
    const c = config(); c.apps.web.projects.staging = { id: "p1" };
    const service = new OpsService(c, new FakeApi(fixture), new FakeApi(() => [{ alias: "a", deploymentId: "d1" }, { alias: "b", deploymentId: "d2" }]));
    expect((await service.status(options(["status", "--env", "staging", "--app", "web"]))).rows?.[0].state).toBe("domains-diverge");
  });
  test("active runs include waiting and queued runs with current job and step", async () => {
    const run: Run = { id: 9, name: "CI", display_title: "CI", path: ".github/workflows/ci.yml", head_sha: sha, head_branch: "main", status: "in_progress", conclusion: null, run_attempt: 2, html_url: "https://github.com/run/9", created_at: "2026-09-23T12:00:00Z", updated_at: "2026-09-23T12:00:00Z", actor: { login: "ops" } };
    const api = new FakeApi(path => path.includes("/jobs") ? [{ name: "Build web", status: "in_progress", steps: [{ name: "Compile", status: "in_progress" }] }] : [run]);
    const service = new OpsService(config(), api);
    const result = await service.runs(options(["runs", "--active"]));
    expect(result.rows).toHaveLength(1); expect(result.rows?.[0].activeJobs).toEqual([{ name: "Build web", status: "in_progress", step: "Compile" }]);
    expect(api.calls.some(c => c.path.includes("/attempts/2/jobs"))).toBe(true);
    expect(api.calls.some(c => c.path.includes("status=waiting"))).toBe(true);
  });
});

test("intentional skips are visible without configuration errors or Vercel queries", async () => {
  const c = config();
  for (const app of Object.values(c.apps)) app.projects = { staging: null, production: null };
  const vercel = new FakeApi(() => { throw new Error("Skipped mappings must not query Vercel"); });
  const service = new OpsService(c, new FakeApi(fixture), vercel);
  const state = await service.status(options(["status"]));
  expect(service.errors).toEqual([]);
  expect(vercel.calls).toHaveLength(0);
  expect(state.rows).toEqual([]);
  expect(state.skipped).toHaveLength(6);
  expect((await service.status(options(["status", "--app", "web", "--env", "production"]))).skipped).toEqual([
    { app: "web", environment: "production", reason: "Skipped in setup; live deployment state is not tracked." },
  ]);
});
test("skips do not conceal genuinely missing mappings or domain divergence", async () => {
  const c = config();
  c.apps.web.projects = { staging: { id: "p1" }, production: null };
  const service = new OpsService(c, new FakeApi(fixture), new FakeApi(() => [{ alias: "web.example.com", deploymentId: "current" }, { alias: "old.vercel.app", deploymentId: "old" }]));
  const state = await service.status(options(["status"]));
  expect(errorInfo(service.errors[0]).details.missingProjectMappings).toEqual(["admin/staging", "admin/production", "landing/staging", "landing/production"]);
  expect(state.rows?.[0].state).toBe("domains-diverge");
  expect(state.skipped).toHaveLength(1);
  expect(service.warnings.join(" ")).toContain("select the hostname");
});
