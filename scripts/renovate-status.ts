// One-shot, read-only snapshot for the renovate-window skill: last Renovate run, open Renovate PRs,
// Dependency Dashboard sections, and every HOLD: rule with the registry facts its REMOVE condition needs.
// Usage: ./scripts/node-ts.sh scripts/renovate-status.ts   (needs an authenticated `gh`)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type PackageRule = { description?: string; matchPackageNames?: string[]; allowedVersions?: string };
type Hold = { packages: string[]; allowedVersions: string; description: string; peerChecks: string[] };
type RegistryFacts = { latest: string; publishedAt: string; peerDependencies: Record<string, string> };

export function parseDashboard(body: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current: string | undefined;
  for (const line of body.split("\n")) {
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      current = heading[1].trim();
      if (current === "Detected Dependencies") current = undefined;
      else sections[current] = [];
      continue;
    }
    const item = line.match(/^\s*- (?:\[[ x]\] )?(.+)$/);
    if (current && item) {
      const text = item[1].replace(/<!--.*?-->/g, "").trim();
      if (text && !text.includes("at once**")) sections[current].push(text);
    }
  }
  return sections;
}

export function parseHolds(config: { packageRules?: PackageRule[] }): Hold[] {
  return (config.packageRules ?? [])
    .filter((rule) => rule.description?.startsWith("HOLD:") && rule.allowedVersions)
    .map((rule) => ({
      packages: rule.matchPackageNames ?? [],
      allowedVersions: rule.allowedVersions!,
      description: rule.description!,
      peerChecks: [...rule.description!.matchAll(/`bun info (\S+?)@latest peerDependencies`/g)].map((m) => m[1]),
    }));
}

async function registry(name: string): Promise<RegistryFacts | { error: string }> {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
  if (!response.ok) return { error: `registry ${response.status}` };
  const doc = (await response.json()) as {
    "dist-tags": { latest: string };
    time: Record<string, string>;
    versions: Record<string, { peerDependencies?: Record<string, string> }>;
  };
  const latest = doc["dist-tags"].latest;
  return { latest, publishedAt: doc.time[latest], peerDependencies: doc.versions[latest]?.peerDependencies ?? {} };
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function lastRun(): Record<string, unknown> {
  const [run] = JSON.parse(gh(["run", "list", "--workflow=renovate.yml", "--limit", "1",
    "--json", "databaseId,status,conclusion,createdAt,event"])) as { databaseId: number; status: string }[];
  if (!run) return { error: "no Renovate runs found" };
  if (run.status !== "completed") return { ...run, repositoryResult: "run not finished" };
  const log = gh(["run", "view", String(run.databaseId), "--log"]);
  const finished = log.lastIndexOf("Repository finished");
  const result = finished < 0 ? undefined : log.slice(finished).match(/"result": "([^"]+)"/)?.[1];
  return { ...run, repositoryResult: result ?? "missing: Renovate did not finish the repository" };
}

export async function main(): Promise<number> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(readFileSync(path.join(root, "renovate.json"), "utf8")) as { packageRules?: PackageRule[] };
  const [dashboard] = JSON.parse(gh(["issue", "list", "--state", "open", "--search", "Dependency Dashboard in:title",
    "--json", "number,body", "--limit", "1"])) as { number: number; body: string }[];
  const prs = JSON.parse(gh(["pr", "list", "--state", "open", "--search", "head:renovate/", "--json",
    "number,title,headRefName,mergeStateStatus,autoMergeRequest,statusCheckRollup"])) as {
    statusCheckRollup: { conclusion?: string; state?: string; name?: string }[];
    autoMergeRequest: unknown;
  }[];

  const holds = await Promise.all(parseHolds(config).map(async (hold) => ({
    ...hold,
    held: Object.fromEntries(await Promise.all(hold.packages.filter((p) => !p.includes("*"))
      .map(async (p) => [p, await registry(p)] as const))),
    peers: Object.fromEntries(await Promise.all(hold.peerChecks.map(async (p) => [p, await registry(p)] as const))),
  })));

  const snapshot = {
    renovateRun: lastRun(),
    nodeBaseline: readFileSync(path.join(root, ".node-version"), "utf8").trim(),
    openPullRequests: prs.map(({ statusCheckRollup, autoMergeRequest, ...pr }) => ({
      ...pr,
      automerge: autoMergeRequest !== null,
      failedChecks: statusCheckRollup.filter((c) => ["FAILURE", "ERROR", "TIMED_OUT"].includes(c.conclusion ?? c.state ?? ""))
        .map((c) => c.name),
      pendingChecks: statusCheckRollup.filter((c) => !(c.conclusion ?? (c.state === "PENDING" ? "" : c.state))).length,
    })),
    dashboard: dashboard ? { issue: dashboard.number, sections: parseDashboard(dashboard.body) } : { error: "not found" },
    holds,
  };
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
