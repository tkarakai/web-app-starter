import { OpsError } from "./errors";
import type { Api } from "./types";

export const deployedApps = ["web", "admin", "landing"] as const;
export const fullSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export function artifactApp(name: string, apps: string[]): string | undefined {
  // build-app resolves <app>-<Turbo input hash>. Legacy SHA-addressed and
  // environment-prefixed archives cannot satisfy that lookup.
  return [...apps].sort((a, b) => b.length - a.length).find(app => name.startsWith(`${app}-`)
    && /^[a-f0-9]{16}$/.test(name.slice(app.length + 1)));
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? `${u.origin}${u.pathname}` : null; }
  catch { return null; }
}
export async function parallel<T, U>(items: T[], fn: (item: T) => Promise<U>): Promise<U[]> {
  const result: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (next < items.length) { const i = next++; result[i] = await fn(items[i]); }
  }));
  return result;
}
export interface TagRef { ref: string; object: { type: string; sha: string } }
export interface DeploymentTag { ref: string; sha: string; runId?: number; taggedAt: string | null }
export async function resolveTag(api: Api, root: string, tag: TagRef): Promise<DeploymentTag> {
  let object = tag.object;
  let annotation = "";
  for (let depth = 0; object?.type === "tag" && depth < 5; depth++) {
    const detail = await api.get<{ object: TagRef["object"]; message?: string }>(`${root}/git/tags/${object.sha}`);
    annotation += `\n${detail.message ?? ""}`; object = detail.object;
  }
  if (object?.type !== "commit" || !fullSha(object.sha) || tag.ref.split("/").at(-1) !== object.sha) {
    throw new OpsError("TAG_CONFLICT", `Deployment tag ${tag.ref} does not resolve to its claimed commit.`, "Inspect the tag target before using it as deployment evidence.", 2, { tag: tag.ref });
  }
  const prefix = `Workflow run: https://github.com/${root.replace(/^\/repos\//, "")}/actions/runs/`;
  const run = annotation.split("\n").find(line => line.startsWith(prefix))?.slice(prefix.length).match(/^(\d+)\s*$/)?.[1];
  const stamp = tag.ref.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
  return { ref: tag.ref, sha: object.sha, ...(run ? { runId: Number(run) } : {}), taggedAt: stamp ? `${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}Z` : null };
}
