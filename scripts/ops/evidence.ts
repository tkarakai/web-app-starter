/** Pure reconciliation. Unknown is preferable to joining on a short SHA or time. */
import { fullSha } from "./types.js";
import type { Candidate, Evidence, Job, Kind, Snapshot } from "./types.js";

export function utc(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  const date = new Date(
    typeof value === "string" && !/[Z+-]\d*:?\d*$/.test(value)
      ? `${value}Z`
      : value,
  );
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return "";
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}
export function newest(events: Evidence[]): Evidence[] {
  return [...events].sort(
    (a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id),
  );
}
function event(
  fields: Pick<Evidence, "id" | "kind" | "state" | "source"> &
    Partial<Evidence>,
): Evidence {
  const result = {
    app: null,
    sha: null,
    environment: null,
    time: "",
    url: "",
    updated_at: "",
    context_sha: null,
    name: "",
    input_hash: null,
    expires_at: "",
    current: null,
    notes: [],
    related: [],
    ...fields,
  };
  result.sha ??= null;
  result.environment ??= null;
  return result;
}
export function reconcile(snapshot: Snapshot, apps: string[]): Evidence[] {
  const base = `https://github.com/${snapshot.repo}`;
  const runs = new Map(snapshot.runs.map((r) => [r.id, r]));
  const jobs = new Map(snapshot.jobs.map((j) => [j.id, j]));
  const targets = new Map<number, string | null>();
  const environments = new Map<number, string | null>();
  for (const run of runs.values()) {
    const path = run.path?.split("/").at(-1) ?? "";
    const tags = snapshot.tags.filter(
      (t) => t.run_id === run.id && t.name.startsWith("deploy/"),
    );
    const shas = new Set<string | null>(tags.map((t) => t.sha));
    const envs = new Set(tags.map((t) => t.name.split("/")[1]));
    if (
      (path === "cd-staging.yml" || path.startsWith("ci-")) &&
      ["push", "workflow_dispatch"].includes(run.event ?? "")
    )
      shas.add(fullSha(run.head_sha));
    targets.set(run.id, shas.size === 1 ? [...shas][0] : null);
    environments.set(
      run.id,
      path === "cd-staging.yml"
        ? "staging"
        : path === "cd-production.yml"
          ? "production"
          : envs.size === 1
            ? [...envs][0]
            : null,
    );
  }
  const jobApp = (job?: Job): string | null => {
    const match =
      /^(?:Build|Resolve|Deploy) (.+?)(?: Artifact)? \((?:Staging|Production|Rollback)\)$/.exec(
        job?.name ?? "",
      );
    const app = match?.[1].toLowerCase().replaceAll(" ", "-");
    return app && (apps.includes(app) || app === "convex") ? app : null;
  };
  const events: Evidence[] = [];
  for (const run of runs.values()) {
    const sha = targets.get(run.id) ?? null;
    events.push(
      event({
        id: `run:${run.id}`,
        kind: "workflow",
        sha,
        environment: environments.get(run.id),
        time: utc(run.created_at),
        state: run.conclusion || run.status || "unknown",
        source: run.path?.split("/").at(-1) ?? "",
        url: `${base}/actions/runs/${run.id}`,
        updated_at: utc(run.updated_at),
        context_sha: fullSha(run.head_sha),
        name: `attempt ${run.run_attempt ?? 1}`,
        notes: sha
          ? []
          : [
              "Requested checkout SHA unknown; workflow head is NOT the deployment target",
            ],
      }),
    );
  }
  for (const job of jobs.values()) {
    const run = runs.get(job.run_id);
    const path = run?.path?.split("/").at(-1) ?? "";
    const ci = /^ci-(.+) \/ Build(?: & Bundle Size)?$/.exec(job.name);
    const ciApp =
      ci?.[1] ??
      (path.startsWith("ci-") &&
      ["Build", "Build & Bundle Size"].includes(job.name)
        ? path.slice(3, -4)
        : null);
    if (ciApp && apps.includes(ciApp)) {
      const step = job.steps?.find((s) => s.name === "Build");
      events.push(
        event({
          id: `ci-build:${job.id}`,
          kind: "ci-build",
          app: ciApp,
          sha: targets.get(job.run_id),
          time: utc(step?.started_at || job.started_at),
          state: step?.conclusion || job.conclusion || job.status || "unknown",
          source: `run ${job.run_id}`,
          url: safeUrl(job.html_url),
          updated_at: utc(step?.completed_at || job.completed_at),
          context_sha: fullSha(run?.head_sha),
          name: job.name,
          notes: [
            "CI build only; no deployable bundle implied. PR checkout SHA not inferred from head_sha.",
          ],
        }),
      );
    }
    const app = jobApp(job);
    if (!app) continue;
    events.push(
      event({
        id: `job:${job.id}`,
        kind: job.name.startsWith("Deploy ") ? "deploy-job" : "build-resolve",
        app,
        sha: targets.get(job.run_id),
        environment: environments.get(job.run_id),
        time: utc(job.started_at),
        state: job.conclusion || job.status || "unknown",
        source: `run ${job.run_id}`,
        url: safeUrl(job.html_url),
        updated_at: utc(job.completed_at),
        context_sha: fullSha(run?.head_sha),
        name: job.name,
        notes: ["Job result, not a serving-state or new-build guarantee"],
      }),
    );
  }
  for (const artifact of snapshot.artifacts) {
    const app = [...apps]
      .sort((a, b) => b.length - a.length)
      .find((a) => artifact.name.startsWith(`${a}-`));
    if (!app) continue;
    const match =
      /^(?:(?:staging|production|preview)-)?([0-9a-f]{16}|[0-9a-f]{40})$/.exec(
        artifact.name.slice(app.length + 1),
      );
    if (!match) continue; // Test reports / arbitrary CI output are not prebuilt CD bundles.
    const runId = artifact.workflow_run?.id;
    const expiry = utc(artifact.expires_at);
    const expired =
      artifact.expired === true ||
      (expiry && expiry <= utc(snapshot.gathered_at));
    const sha = runId ? targets.get(runId) : null;
    events.push(
      event({
        id: `artifact:${artifact.id}`,
        kind: "artifact",
        app,
        sha,
        time: utc(artifact.created_at),
        state: expired
          ? "expired"
          : artifact.expired === false && expiry
            ? "available"
            : "unknown",
        source: `build run ${runId ?? "unknown"}`,
        url: runId
          ? `${base}/actions/runs/${runId}/artifacts/${artifact.id}`
          : "",
        context_sha: fullSha(artifact.workflow_run?.head_sha),
        name: artifact.name,
        input_hash: match[1].length === 16 ? match[1] : null,
        expires_at: expiry,
        notes: [
          "Upload time; checkout SHA from workflow evidence, not verified provenance",
          "Manifest, tarball checksum and SLSA attestation not downloaded or verified",
          ...(!sha
            ? ["Builder checkout unknown; artifact head_sha is context only"]
            : []),
        ],
      }),
    );
  }
  for (const tag of snapshot.tags) {
    const deploy = tag.name.startsWith("deploy/");
    events.push(
      event({
        id: `tag:${tag.name}`,
        kind: deploy ? "deploy-tag" : "release-tag",
        sha: tag.sha,
        environment: deploy ? tag.name.split("/")[1] : null,
        time: utc(tag.time),
        state: deploy ? "recorded" : "source-release",
        source: "git tag",
        url: `${base}/tree/${encodeURIComponent(tag.name)}`,
        name: tag.name,
        notes: [
          deploy
            ? "Repository-wide marker; does not prove every app deployed or is healthy"
            : "Starter source version; not a deployable artifact or deployment",
        ],
      }),
    );
  }
  for (const row of snapshot.vercel) {
    const dep = row.deployment;
    const meta = dep.meta ?? {};
    const claims = new Set(
      [fullSha(meta.githubCommitSha), fullSha(meta.gitCommitSha)].filter(
        (s): s is string => s !== null,
      ),
    );
    let sha = claims.size === 1 ? [...claims][0] : null;
    const notes = ["Vercel git metadata; no artifact identity supplied"];
    if (claims.size > 1)
      notes.push("Conflicting commit metadata; SHA withheld");
    if (
      meta.githubCommitOrg &&
      meta.githubCommitRepo &&
      `${meta.githubCommitOrg}/${meta.githubCommitRepo}`.toLowerCase() !==
        snapshot.repo.toLowerCase()
    ) {
      sha = null;
      notes.push("Metadata names a different repository; SHA withheld");
    }
    events.push(
      event({
        id: `vercel:${dep.uid}`,
        kind: "vercel",
        app: row.app,
        sha,
        environment: row.environment,
        time: utc(dep.createdAt ?? dep.created),
        state: dep.readyState || dep.state || "unknown",
        source: `Vercel ${row.project}`,
        url: dep.url
          ? safeUrl(
              dep.url.startsWith("https://") ? dep.url : `https://${dep.url}`,
            )
          : "",
        updated_at: utc(dep.ready ?? dep.readyAt),
        current: row.current,
        notes,
      }),
    );
  }
  for (const dep of snapshot.deployments) {
    const statuses = [...(dep.statuses ?? [])].sort(
      (a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
        (b.id ?? 0) - (a.id ?? 0),
    );
    const status = statuses[0];
    const url =
      statuses.map((s) => safeUrl(s.environment_url)).find(Boolean) ?? "";
    const log = statuses.map((s) => safeUrl(s.log_url)).find(Boolean) ?? "";
    const relative = log.startsWith(`${base}/actions/runs/`)
      ? log.slice(base.length)
      : "";
    const match = /^\/actions\/runs\/(\d+)\/job\/(\d+)$/.exec(relative);
    const runId = match ? Number(match[1]) : 0;
    let app = jobApp(match ? jobs.get(Number(match[2])) : undefined);
    let sha = targets.get(runId) ?? null;
    const peers = events.filter(
      (e) =>
        e.kind === "vercel" &&
        url &&
        e.url === url &&
        e.environment === dep.environment &&
        (!app || e.app === app),
    );
    const notes = [
      "GitHub environment status; inactive is not proof of Vercel serving state",
    ];
    if (peers.length === 1) {
      app ||= peers[0].app;
      if (sha && peers[0].sha && sha !== peers[0].sha) {
        notes.push(
          "CONFLICT: workflow target and Vercel commit differ; SHA withheld",
        );
        peers[0].notes.push(
          "CONFLICT: GitHub workflow target differs; inspect both sources",
        );
        sha = null;
      } else sha ||= peers[0].sha;
    }
    if (!sha)
      notes.push(
        "Deployment target unknown; GitHub deployment.sha is context only",
      );
    const evidence = event({
      id: `github-deployment:${dep.id}`,
      kind: "github-deployment",
      app,
      sha,
      environment: dep.environment,
      time: utc(dep.created_at),
      state: status?.state || "unknown",
      source: `GitHub deployment ${dep.id}`,
      url: url || log,
      updated_at: utc(status?.created_at),
      context_sha: fullSha(dep.sha),
      notes,
      related: peers.map((e) => e.id),
    });
    for (const peer of peers) peer.related.push(evidence.id);
    events.push(evidence);
  }
  // Full SHA/app links are browsing aids, NOT claims that these bytes shipped.
  for (const e of events)
    if (
      e.sha &&
      e.app &&
      ["vercel", "github-deployment", "deploy-job"].includes(e.kind)
    ) {
      e.related.push(
        ...events
          .filter(
            (a) => a.kind === "artifact" && a.sha === e.sha && a.app === e.app,
          )
          .map((a) => a.id),
      );
    }
  return newest(events);
}
export function candidates(
  snapshot: Snapshot,
  events: Evidence[],
  apps: string[],
  limit: number,
  sha?: string,
): Candidate[] {
  const commits = sha
    ? [sha]
    : [
        ...new Set(
          events
            .filter((e) => e.sha && e.kind !== "release-tag")
            .map((e) => e.sha!),
        ),
      ];
  const latest = (commit: string): string =>
    events
      .filter((e) => e.sha === commit)
      .map((e) => e.time)
      .sort()
      .at(-1) ?? "";
  commits.sort(
    (a, b) => latest(b).localeCompare(latest(a)) || b.localeCompare(a),
  );
  return commits.slice(0, limit).map((commit) => {
    const records = events.filter((e) => e.sha === commit);
    const staging = records.filter(
      (e) => e.kind === "deploy-tag" && e.environment === "staging",
    );
    const production = records.filter(
      (e) => e.kind === "deploy-tag" && e.environment === "production",
    );
    const gate = snapshot.gates[commit] ?? { state: "unknown" };
    return {
      sha: commit,
      classification:
        staging.length && gate.state === "success"
          ? "gates-pass"
          : ["failure", "error", "pending"].includes(gate.state)
            ? "blocked"
            : "insufficient-evidence",
      reasons: [
        staging.length
          ? "Verified staging tag"
          : "No verified staging tag in inspected evidence",
        `ci/gate-passed: ${gate.state}`,
      ],
      staging: staging.map((e) => e.time),
      production: production.map((e) => e.time),
      gate_url: safeUrl(gate.target_url),
      artifacts: Object.fromEntries(
        apps.map((app) => [
          app,
          records
            .filter((e) => e.kind === "artifact" && e.app === app)
            .map((e) => ({
              name: e.name,
              state: e.state,
              url: e.url,
              uploaded_at: e.time,
              expires_at: e.expires_at,
              input_hash: e.input_hash,
            })),
        ]),
      ),
      release_tags: records
        .filter((e) => e.kind === "release-tag")
        .map((e) => e.name),
      limitations: [
        "Gates only, not approval or a deployment/health guarantee",
        "Same-checkout uploads only; input-hash equivalence and reusable artifacts remain unresolved",
        "Production resolves or builds on a miss; landing configuration is environment-specific",
        "No manifest/checksum/attestation verification; no Convex compatibility check",
      ],
    };
  });
}
export function ofKind(events: Evidence[], kinds: Kind[]): Evidence[] {
  return events.filter((e) => kinds.includes(e.kind));
}
