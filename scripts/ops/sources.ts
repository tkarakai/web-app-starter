/** Bounded GET-only collectors. Raw responses and subprocess stderr never reach output. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ENVIRONMENTS, ROOT, WORKFLOWS } from "./config.js";
import { errorMessage, fullSha, object } from "./types.js";
import { annotationRunId } from "./urls.js";
import type {
  Artifact,
  Config,
  Coverage,
  DeploymentStatus,
  Gate,
  GitHubDeployment,
  Job,
  Ref,
  Run,
  Snapshot,
  Tag,
  TagObject,
  VercelDeployment,
  VercelRow,
} from "./types.js";

const execute = promisify(execFile);
export class SourceError extends Error {}
export type Get = (path: string) => Promise<unknown>;
export type Command = (file: string, args: string[]) => Promise<string>;
export function createGithubGet(
  run: Command = async (file, args) => {
    const { stdout } = await execute(file, args, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1" },
    });
    return stdout;
  },
): Get {
  return async (path) => {
    try {
      return JSON.parse(
        await run("gh", ["api", "--method", "GET", path]),
      ) as unknown;
    } catch {
      throw new SourceError(
        "GitHub unavailable; check gh installation/authentication, read permissions, connection and rate limits",
      );
    }
  };
}
export const githubGet = createGithubGet();
export const vercelGet: Get = async (path) => {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new SourceError("VERCEL_TOKEN not set");
  try {
    const response = await fetch(`https://api.vercel.com${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new SourceError(
        `Vercel HTTP ${response.status}; check token, scope, project ID or rate limits`,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new SourceError("Vercel response has no body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024 * 1024) {
        await reader.cancel();
        throw new SourceError("Vercel response exceeded size limit");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError("Vercel unavailable or invalid response");
  }
};
export function tagTime(ref: string): string {
  const match = /\/(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\dZ)\//.exec(ref);
  return match ? `${match[1]}:${match[2]}:${match[3]}` : "";
}
const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function parallel<T, U>(
  items: T[],
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}
export class Collector {
  readonly coverage: Coverage[] = [];
  readonly base: string;
  constructor(
    readonly config: Config,
    readonly limit: number,
    readonly pages: number,
    readonly gh: Get = githubGet,
    readonly vercel: Get = vercelGet,
  ) {
    this.base = `repos/${config.repo}`;
  }
  note(source: string, state: Coverage["state"], detail: string): void {
    this.coverage.push({ source, state, detail });
  }
  async get(path: string, label: string): Promise<unknown> {
    try {
      return await this.gh(`${this.base}/${path}`);
    } catch (error) {
      this.note(
        label,
        "unavailable",
        error instanceof SourceError
          ? error.message
          : "Unexpected GitHub transport failure",
      );
      return null;
    }
  }
  async record<T>(path: string, label: string): Promise<T | null> {
    const data = await this.get(path, label);
    if (data === null) return null;
    if (typeof data !== "object" || Array.isArray(data)) {
      this.note(label, "partial", "Unexpected API response");
      return null;
    }
    return data as T;
  }
  async listing<T>(
    path: string,
    label: string,
    key?: string,
    pageSize = 100,
    pages = this.pages,
  ): Promise<T[]> {
    const records: T[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page++) {
      const data = await this.get(
        `${path}${path.includes("?") ? "&" : "?"}per_page=${pageSize}&page=${page}`,
        label,
      );
      if (data === null) return records;
      const items: unknown = key ? object(data)[key] : data;
      if (!Array.isArray(items)) {
        this.note(label, "unavailable", "Unexpected API response");
        return records;
      }
      const fingerprint = JSON.stringify(items);
      if (items.length && seen.has(fingerprint)) {
        this.note(label, "partial", "Pagination repeated a page; stopped");
        return records;
      }
      seen.add(fingerprint);
      records.push(...(items as T[]));
      const total = object(data).total_count;
      if (
        items.length < pageSize ||
        (typeof total === "number" && records.length >= total)
      ) {
        this.note(label, "complete", `${records.length} records`);
        return records;
      }
    }
    this.note(
      label,
      "windowed",
      `${records.length} records; page cap reached (increase --pages / --limit)`,
    );
    return records;
  }
  async tags(prefix: string, sha?: string): Promise<Tag[]> {
    // matching-refs has no pagination parameters; it returns annotated object IDs.
    const data = await this.get(
      `git/matching-refs/tags/${prefix}`,
      `${prefix} refs`,
    );
    if (!Array.isArray(data)) return [];
    let refs = data as Ref[];
    this.note(`${prefix} refs`, "complete", `${refs.length} refs`);
    if (prefix === "deploy/")
      refs.sort(
        (a, b) =>
          tagTime(b.ref).localeCompare(tagTime(a.ref)) ||
          b.ref.localeCompare(a.ref),
      );
    else {
      refs = refs.filter((r) => /^refs\/tags\/v\d+\.\d+\.\d+$/.test(r.ref));
      refs.sort((a, b) => {
        const left = a.ref.split("/v").at(-1)!.split(".").map(Number);
        const right = b.ref.split("/v").at(-1)!.split(".").map(Number);
        return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
      });
    }
    const selected =
      prefix === "deploy/"
        ? ENVIRONMENTS.flatMap((env) =>
            refs
              .filter((r) => r.ref.startsWith(`refs/tags/deploy/${env}/`))
              .slice(0, this.limit),
          )
        : refs.slice(0, this.limit);
    if (sha)
      selected.push(
        ...refs.filter(
          (r) => r.ref.endsWith(`/${sha}`) && !selected.includes(r),
        ),
      );
    if (selected.length < refs.length)
      this.note(
        `${prefix} tag details`,
        "windowed",
        `Resolved ${selected.length} of ${refs.length} refs`,
      );
    const tags = await parallel(selected, async (ref) => {
      let obj = ref.object;
      let message = "";
      for (let depth = 0; depth < 5 && obj.type === "tag"; depth++) {
        const detail = await this.record<TagObject>(
          `git/tags/${obj.sha}`,
          "tag detail",
        );
        if (!detail) return null;
        message += `\n${detail.message ?? ""}`;
        obj = detail.object;
      }
      const target = obj.type === "commit" ? fullSha(obj.sha) : null;
      if (!target) {
        this.note(
          "tag detail",
          "partial",
          "Tag does not resolve to a full commit SHA",
        );
        return null;
      }
      const name = ref.ref.replace(/^refs\/tags\//, "");
      if (prefix === "deploy/" && name.split("/").at(-1) !== target) {
        this.note(
          "tag detail",
          "partial",
          "Deployment tag suffix and target differ; ignored",
        );
        return null;
      }
      return {
        name,
        sha: target,
        time: tagTime(ref.ref),
        run_id: annotationRunId(message, this.config.repo),
      };
    });
    return tags.filter((tag): tag is Tag => tag !== null);
  }
  async collect(sha?: string, noVercel = false): Promise<Snapshot> {
    const tags = [
      ...(await this.tags("deploy/", sha)),
      ...(await this.tags("v")),
    ];
    const workflows = [
      ...WORKFLOWS,
      ...this.config.apps
        .map((app) => `ci-${app}.yml`)
        .filter((file) => existsSync(resolve(ROOT, ".github/workflows", file))),
    ];
    const runs = (
      await parallel(workflows, (workflow) => {
        const query =
          sha && !["cd-production.yml", "cd-rollback.yml"].includes(workflow)
            ? `&head_sha=${sha}`
            : "";
        return this.listing<Run>(
          `actions/workflows/${workflow}/runs?exclude_pull_requests=true${query}`,
          workflow,
          "workflow_runs",
          this.limit,
          1,
        );
      })
    ).flat();
    const ids = new Set(runs.map((r) => r.id));
    for (const tag of tags)
      if (tag.run_id && !ids.has(tag.run_id)) {
        const run = await this.record<Run>(
          `actions/runs/${tag.run_id}`,
          "tag workflow",
        );
        if (run) {
          runs.push(run);
          ids.add(run.id);
        }
      }
    const jobs = (
      await parallel(runs, async (run) =>
        (
          await this.listing<Job>(
            `actions/runs/${run.id}/jobs?filter=latest`,
            `jobs/${run.id}`,
            "jobs",
          )
        ).map((job) => ({ ...job, run_id: run.id })),
      )
    ).flat();
    const inventory = await this.listing<Artifact>(
      "actions/artifacts",
      "artifacts",
      "artifacts",
    );
    inventory.push(
      ...(
        await parallel(
          runs.filter((r) =>
            WORKFLOWS.includes(r.path?.split("/").at(-1) ?? ""),
          ),
          (run) =>
            this.listing<Artifact>(
              `actions/runs/${run.id}/artifacts`,
              `artifacts/${run.id}`,
              "artifacts",
            ),
        )
      ).flat(),
    );
    const artifacts = [...new Map(inventory.map((a) => [a.id, a])).values()];
    const names = this.config.apps.map(escape).join("|");
    const bundle = new RegExp(
      `^(?:${names})-(?:(?:staging|production|preview)-)?(?:[0-9a-f]{16}|[0-9a-f]{40})$`,
    );
    const builders = new Set(
      artifacts
        .filter((a) => bundle.test(a.name))
        .map((a) => a.workflow_run?.id),
    );
    for (const id of [...builders]
      .filter((id): id is number => id !== undefined && !ids.has(id))
      .sort((a, b) => a - b)) {
      const run = await this.record<Run>(
        `actions/runs/${id}`,
        "artifact builder",
      );
      if (run) runs.push(run);
    }
    const deployments = (
      await parallel(ENVIRONMENTS, (env) =>
        this.listing<GitHubDeployment>(
          `deployments?environment=${env}`,
          `deployments/${env}`,
          undefined,
          Math.min(100, this.limit * 4),
          1,
        ),
      )
    ).flat();
    const withStatuses = await parallel(deployments, async (dep) => ({
      ...dep,
      statuses: await this.listing<DeploymentStatus>(
        `deployments/${dep.id}/statuses`,
        `deployment status/${dep.id}`,
      ),
    }));
    const vercel = await this.collectVercel(noVercel);
    const commits = new Set(tags.map((t) => t.sha));
    for (const run of runs)
      if (run.path?.endsWith("/cd-staging.yml") && fullSha(run.head_sha))
        commits.add(fullSha(run.head_sha)!);
    if (sha) commits.add(sha);
    const gates = Object.fromEntries(
      await parallel([...commits].sort(), async (commit) => {
        const data = await this.record<{
          statuses?: (Gate & { context: string })[];
          total_count?: number;
        }>(`commits/${commit}/status?per_page=100`, `CI gate/${commit}`);
        const gate = data?.statuses?.find(
          (s) => s.context === "ci/gate-passed",
        );
        const result: Gate = gate
          ? {
              state: gate.state,
              target_url: gate.target_url,
              updated_at: gate.updated_at,
            }
          : {
              state: !data
                ? "unknown"
                : (data.total_count ?? 0) <= 100
                  ? "missing"
                  : "unknown",
            };
        return [commit, result];
      }),
    );
    this.coverage.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.state.localeCompare(b.state) ||
        a.detail.localeCompare(b.detail),
    );
    return {
      repo: this.config.repo,
      gathered_at: new Date().toISOString(),
      tags,
      runs,
      jobs,
      artifacts,
      deployments: withStatuses,
      vercel,
      gates,
      coverage: this.coverage,
    };
  }
  async collectVercel(disabled: boolean): Promise<VercelRow[]> {
    const rows: VercelRow[] = [];
    for (const app of this.config.apps)
      for (const environment of ENVIRONMENTS) {
        const label = `Vercel/${app}/${environment}`;
        const project = this.config.projects[app]?.[environment];
        if (disabled || !project) {
          this.note(
            label,
            "unavailable",
            disabled ? "Disabled by --no-vercel" : "Project ID not configured",
          );
          continue;
        }
        const params = new URLSearchParams(
          this.config.team_id ? { teamId: this.config.team_id } : {},
        );
        let target: VercelDeployment = {};
        let current: string | undefined;
        try {
          const detail = object(
            await this.vercel(
              `/v9/projects/${encodeURIComponent(project)}?${params}`,
            ),
          );
          target = object(
            object(detail.targets).production,
          ) as VercelDeployment;
          current = target.id;
          if (!current)
            this.note(
              `${label}/current`,
              "partial",
              "No production target reported; serving deployment unknown",
            );
        } catch (error) {
          this.note(
            `${label}/current`,
            "unavailable",
            error instanceof SourceError
              ? error.message
              : "Unexpected Vercel project response",
          );
        }
        try {
          params.set("projectId", project);
          params.set("limit", "100");
          const seen = new Set<string>();
          for (let page = 0; page < this.pages; page++) {
            const data = object(await this.vercel(`/v7/deployments?${params}`));
            if (!Array.isArray(data.deployments))
              throw new SourceError("Unexpected Vercel response");
            for (const deployment of data.deployments as VercelDeployment[])
              rows.push({
                app,
                environment,
                project,
                deployment,
                current: current ? deployment.uid === current : null,
              });
            const cursor = object(data.pagination).next;
            if (cursor === null || cursor === undefined) {
              this.note(label, "complete", "Deployment list exhausted");
              break;
            }
            if (seen.has(String(cursor))) {
              this.note(
                label,
                "partial",
                "Repeated pagination cursor; stopped",
              );
              break;
            }
            seen.add(String(cursor));
            params.set("until", String(cursor));
            if (page + 1 === this.pages)
              this.note(
                label,
                "windowed",
                "Page cap reached; increase --pages",
              );
          }
        } catch (error) {
          this.note(
            label,
            "unavailable",
            error instanceof SourceError
              ? errorMessage(error)
              : "Unexpected Vercel response",
          );
        }
        if (current && !rows.some((r) => r.deployment.uid === current))
          rows.push({
            app,
            environment,
            project,
            deployment: { ...target, uid: current },
            current: true,
          });
      }
    return rows;
  }
}
