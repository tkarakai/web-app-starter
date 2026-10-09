import { run, type Run } from "../deploy-setup/io.ts";
import type { RequiredCheck, WorkflowRecord } from "./types.ts";

export function statusCode(error: unknown): number | undefined {
  return error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : undefined;
}
export async function request<T>(endpoint: string, exec: Run = run, method = "GET", body?: unknown): Promise<T> {
  const args = ["api", endpoint, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  const text = await exec("gh", args, body === undefined ? undefined : JSON.stringify(body));
  return (text ? JSON.parse(text) : undefined) as T;
}
export async function pages<T>(endpoint: string, exec: Run): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = await request<T[]>(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`, exec);
    if (!Array.isArray(result)) throw Error("Invalid paginated repository response");
    rows.push(...result);
    if (result.length < 100) return rows;
  }
  throw Error("Repository pagination exceeded the inspection limit");
}
type Pull = { number: number; base: { ref: string; repo: { full_name: string } }; head: { sha: string }; merge_commit_sha?: string | null };
type CheckRun = { name: string; head_sha: string; app: { id: number; slug: string }; pull_requests?: { number: number }[] };
export async function discoverChecks(repo: string, branch: string, labels: string[], exec: Run, pr?: number): Promise<WorkflowRecord["discovery"]> {
  let selected = pr;
  if (!selected) {
    const pulls = await request<{ number: number }[]>(`repos/${repo}/pulls?state=all&base=${encodeURIComponent(branch)}&sort=created&direction=asc&per_page=1`, exec);
    if (!Array.isArray(pulls)) throw Error("Invalid first-PR response");
    selected = pulls[0]?.number;
  }
  if (!selected) return undefined;
  const pull = await request<Pull>(`repos/${repo}/pulls/${selected}`, exec);
  if (pull.base?.ref !== branch || pull.base?.repo?.full_name?.toLowerCase() !== repo.toLowerCase() || !/^[a-f0-9]{40}$/.test(pull.head?.sha)) throw Error("Discovery PR must target this repository's default branch");
  const runs: CheckRun[] = [];
  for (const sha of new Set([pull.head.sha, ...(pull.merge_commit_sha ? [pull.merge_commit_sha] : [])])) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error("Invalid PR check commit");
    for (let page = 1; page <= 100; page++) {
      const result = await request<{ total_count: number; check_runs: CheckRun[] }>(`repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`, exec);
      if (!Array.isArray(result.check_runs) || !Number.isSafeInteger(result.total_count)) throw Error("Invalid check-runs response");
      runs.push(...result.check_runs.filter(c => c.head_sha === sha && (!c.pull_requests?.length || c.pull_requests.some(p => p.number === selected))));
      if (page * 100 >= result.total_count) break;
      if (page === 100) throw Error("Check-run pagination exceeded the inspection limit");
    }
  }
  const checks: RequiredCheck[] = [];
  for (const label of labels) {
    const matches = runs.filter(c => typeof c.name === "string" && (c.name === label || c.name.endsWith(" / " + label))
      && Number.isSafeInteger(c.app?.id) && c.app.id > 0 && (c.app.slug === "github-actions" || label === "CodeQL" && c.app.slug === "github-code-scanning"));
    const distinct = [...new Map(matches.map(c => [c.name + ":" + c.app.id, c])).values()];
    if (distinct.length > 1) throw Error(`Ambiguous PR contexts for ${label}; review caller names before resuming`);
    if (distinct[0]) checks.push({ label, context: distinct[0].name, appId: distinct[0].app.id });
  }
  return { pr: selected, sha: pull.head.sha, checks };
}
