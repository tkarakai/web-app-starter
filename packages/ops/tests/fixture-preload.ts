// Loaded only by subprocess integration tests. Unexpected calls fail closed: no network.
const sha = "a".repeat(40), old = "b".repeat(40);
let requestId = "";
let polls = 0;
const mode = process.env.OPS_TEST_MODE;
const recordedSha = mode === "serving-wrong-target" ? old : sha;
globalThis.fetch = (async (input: string | URL | Request, init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const path = url.pathname;
  if (mode === "forbidden" || (mode === "github-auth-failed" && url.hostname === "api.github.com")) return Response.json({ message: "Access denied for fixture-token" }, { status: 403 });
  if (url.hostname === "api.vercel.com") {
    if (path === "/v2/user") return Response.json({ user: { username: "vercel-operator" } });
    if (path === "/v2/teams") return Response.json({ teams: [{ id: "team_1", slug: "my-team", name: "My Team" }] });
    if (mode === "partial") return Response.json({ error: { message: "Project inaccessible" } }, { status: 403 });
    if (mode?.startsWith("serving") && path.endsWith("/aliases")) {
      const app = url.searchParams.get("projectId")?.replace("prj_", "");
      return Response.json({ aliases: [{ alias: `${app}.example.com`, deploymentId: `dpl_${app}` }] });
    }
    if (mode?.startsWith("serving") && path.includes("/deployments/")) {
      const app = path.split("/").at(-1)?.replace("dpl_", "");
      return Response.json({ id: `dpl_${app}`, readyState: "READY", url: `${app}.vercel.app`, meta: { opsSelectedSha: mode === "serving-mismatch" && app === "web" ? old : recordedSha, opsBuiltSha: old, opsRunId: "42", opsRunAttempt: "1" } });
    }
    if (path.endsWith("/aliases")) return Response.json({ aliases: [{ alias: "staging.example.com", deploymentId: "dpl_1" }] });
    if (path.includes("/deployments/")) return Response.json({ id: "dpl_1", readyState: "READY", url: "test.vercel.app", meta: { opsSelectedSha: sha, opsBuiltSha: old, opsRunId: "42", opsRunAttempt: "1" } });
    if (path.endsWith("/projects")) return Response.json({ projects: [{ id: "prj_1", name: "web-staging" }] });
  }
  if (url.hostname !== "api.github.com") throw new Error(`Forbidden fixture host ${url.hostname}`);
  if (path === "/user") return Response.json({ login: "github-operator" });
  if (path === "/repos/team/repo") return Response.json({ full_name: "team/repo", default_branch: "main" });
  if (path === "/repos/team/repo/commits") return Response.json((mode === "artifact-candidates" ? [sha, old] : [sha]).map(commitSha => ({ sha: commitSha,
    commit: { message: commitSha === sha ? "Fix invitations" : "Release script only", author: { date: "2026-09-23T12:00:00Z" } }, html_url: `https://github.com/team/repo/commit/${commitSha}` })));
  if (path.endsWith("/dispatches")) {
    requestId = JSON.parse(String(init?.body)).inputs.request_id;
    return new Response(null, { status: 204 });
  }
  if (path.includes("/git/matching-refs/")) return Response.json([{ ref: `refs/tags/deploy/staging/2026-09-23T12-00-00Z/${sha}`, object: { type: "commit", sha } }]);
  if (path.endsWith("/status")) return Response.json({ statuses: [{ context: "ci/gate-passed", state: "success" }] });
  if (path.includes("/commits/")) return Response.json({ sha, commit: { message: "Fix invitations", author: { date: "2026-09-23T12:00:00Z" } }, html_url: "https://github.com/team/repo/commit/" + sha });
  if (mode === "artifact-candidates") {
    const artifacts = [
      { id: 1, name: `web-${"c".repeat(16)}`, expired: false, created_at: "2026-09-23T12:00:00Z", expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: 42, head_sha: sha } },
      { id: 2, name: "playwright-report-web", expired: false, expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: 43, head_sha: old } },
      { id: 3, name: `web-${old}`, expired: false, expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: 43, head_sha: old } },
      { id: 4, name: `admin-production-${old}`, expired: false, expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: 43, head_sha: old } },
    ];
    if (path.endsWith("/artifacts")) return Response.json({ artifacts: artifacts.filter(a => !path.includes("/runs/") || path.includes(`/runs/${a.workflow_run.id}/`)) });
    if (path.endsWith("/deployments")) return Response.json([]);
    const run = (head: string) => ({ id: head === sha ? 42 : 43, event: "push", head_sha: head, status: "completed", path: ".github/workflows/cd-staging.yml" });
    if (path.includes("/workflows/") && path.endsWith("/runs")) return Response.json({ workflow_runs: [run(url.searchParams.get("head_sha")!)] });
    if (path.endsWith("/runs/42") || path.endsWith("/runs/43")) return Response.json(run(path.endsWith("/42") ? sha : old));
  }
  if (path.endsWith("/artifacts")) return Response.json({ artifacts: [{ id: 1, name: "web-hash", expired: false, created_at: "2026-09-23T12:00:00Z", expires_at: "2099-01-01T00:00:00Z", workflow_run: { id: 40, head_sha: old } }] });
  if (path.endsWith("/deployments") && mode === "unchanged") return Response.json(["web", "admin", "landing", "backend"].map((app, i) => ({
    id: i + 1, sha, environment: "staging", created_at: "2026-09-23T12:00:00Z",
    payload: { schemaVersion: 1, environment: "staging", selectedSha: sha, app, runId: 42, runAttempt: 1, result: "unchanged" },
  })));
  if (path.endsWith("/deployments") && mode?.startsWith("serving")) return Response.json(
    ["web", "admin", "landing", ...(mode === "serving-incomplete" ? [] : ["backend"])].map((app, i) => ({ id: i + 1, sha: recordedSha, environment: "staging", created_at: "2026-09-23T12:00:00Z",
      payload: { schemaVersion: 1, selectedSha: recordedSha, app, runId: 42, runAttempt: 1, result: "success", health: "success", deploymentUrl: `https://${app}.vercel.app` } })));
  if (path.endsWith("/deployments")) return Response.json([{ id: 1, sha, environment: "staging", created_at: "2026-09-23T12:00:00Z", payload: { schemaVersion: 1, selectedSha: sha, app: "web", artifactId: 1, artifactName: "web-hash", builtSha: old, runId: 42, runAttempt: 1, result: "success", health: "success" } }]);
  const run = { id: 42, name: "Deploy Staging", path: ".github/workflows/cd-staging.yml", display_title: `Deploy [ops:${requestId}]`, head_sha: sha, head_branch: "main", status: "completed", conclusion: mode === "failed" ? "failure" : "success", run_attempt: mode === "rerun" ? 2 : 1, actor: { login: "operator" }, html_url: "https://github.com/team/repo/actions/runs/42", created_at: "2026-09-23T12:00:00Z" };
  if (path.endsWith("/runs")) return Response.json({ workflow_runs: url.searchParams.has("status") || (path.includes("/workflows/") && !path.includes("cd-staging.yml")) ? [] : [run] });
  if (path.endsWith("/jobs")) return Response.json({ jobs: [{ id: 8, name: "Build web", status: polls === 1 ? "in_progress" : "completed", conclusion: polls === 1 ? null : run.conclusion, steps: [{ name: "Compile", status: polls === 1 ? "in_progress" : "completed", conclusion: run.conclusion }], html_url: run.html_url }] });
  if (path.endsWith("/runs/42")) { polls++; return Response.json({ ...run, status: mode?.startsWith("serving") ? "completed" : mode === "timeout" || polls === 1 ? "in_progress" : "completed" }); }
  if (path.includes("/compare/")) return Response.json({ status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1, commits: [], files: [], html_url: "https://github.com/team/repo/compare/abc...def" });
  throw new Error(`Unhandled fixture request ${path}`);
}) as typeof fetch;
