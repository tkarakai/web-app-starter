import { run, type Run } from "../deploy-setup/io.ts";
import type { RequiredCheck, WorkflowRecord } from "./types.ts";
import { checkInventory } from "./state.ts";

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
async function variablePages(endpoint: string, exec: Run): Promise<Map<string, string>> {
  const variables = new Map<string, string>();
  let total: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const result = await request<{ total_count: number; variables: { name: string; value: string }[] }>(`${endpoint}?per_page=30&page=${page}`, exec);
    if (!Number.isSafeInteger(result?.total_count) || result.total_count < 0 || !Array.isArray(result.variables)
      || total !== undefined && total !== result.total_count
      || result.variables.length !== Math.min(30, result.total_count - variables.size)) throw Error("Incomplete or invalid repository-scoped variables");
    total = result.total_count;
    for (const variable of result.variables) {
      if (!variable || typeof variable.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name)
        || typeof variable.value !== "string" || variables.has(variable.name.toUpperCase())) throw Error("Invalid or ambiguous repository-scoped variable");
      variables.set(variable.name.toUpperCase(), variable.value);
    }
    if (variables.size === total) return variables;
  }
  throw Error("Variable pagination exceeded the inspection limit");
}
export async function effectiveVariables(repo: string, organization: boolean, exec: Run): Promise<Map<string, string>> {
  const local = await variablePages(`repos/${repo}/actions/variables`, exec);
  const inherited = organization ? await variablePages(`repos/${repo}/actions/organization-variables`, exec) : new Map<string, string>();
  return new Map([...inherited, ...local]);
}
export async function committedChecks(repo: string, sha: string, isPrivate: boolean, exec: Run): Promise<string[]> {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error("An immutable default-branch commit is required");
  const tree = await request<{ sha: string; truncated: boolean; tree: { path: string; type: string; mode: string; sha: string }[] }>(`repos/${repo}/git/trees/${sha}?recursive=1`, exec);
  if (!tree || typeof tree.sha !== "string" || !/^[a-f0-9]{40}$/.test(tree.sha) || tree.truncated !== false || !Array.isArray(tree.tree)) throw Error("Complete committed inventory is unavailable");
  const files = new Set<string>(), paths = new Set<string>();
  for (const entry of tree.tree) {
    if (!entry || typeof entry.path !== "string" || !entry.path || paths.has(entry.path)
      || typeof entry.sha !== "string" || !/^[a-f0-9]{40}$/.test(entry.sha)
      || !(entry.type === "blob" && ["100644", "100755", "120000"].includes(entry.mode)
        || entry.type === "tree" && entry.mode === "040000" || entry.type === "commit" && entry.mode === "160000")) throw Error("Invalid committed inventory");
    paths.add(entry.path);
    if (entry.type === "blob") files.add(entry.path);
  }
  return checkInventory(isPrivate, file => files.has(file));
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
