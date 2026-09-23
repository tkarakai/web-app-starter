import { OpsError, usage } from "./errors";
import type { Api, Artifact, Commit, Config, Deployment, Environment, Job, Result, Run, VercelDeployment, Alias } from "./types";
import type { Options } from "./options";

export class OpsService {
  errors: unknown[] = [];
  warnings: string[] = [];
  readonly root: string;
  constructor(readonly config: Config, readonly gh: Api, readonly vercel?: Api, readonly configPath = "ops.config.json") { this.root = `/repos/${config.repository}`; }
  projectConfigurationError(missing: string[]): OpsError {
    return new OpsError("CONFIG_MISSING",
      `Configuration missing: Vercel project mappings are missing for ${missing.join(", ")}. Live deployment state was not queried for these targets.`,
      `Run bun run ops setup --config ${JSON.stringify(this.configPath)} for guided login, team discovery and project mapping.\n` +
      `Manual setup: create ${this.configPath} from ops.config.example.json, then run gh auth login and vercel login.\n` +
      "Run bun run ops teams to find teamId, then bun run ops projects --team TEAM_ID to find project IDs.\n" +
      "Fill apps.<app>.projects.<environment>.id for the missing targets, then rerun the command. CI can supply VERCEL_TOKEN via a secret manager.\n" +
      "See docs/ops-cli.md for the setup walkthrough.",
      2, { configPath: this.configPath, missingProjectMappings: missing });
  }
  requireVercel(): Api {
    if (!this.vercel) throw new OpsError("CONFIG", "Vercel API access has not been initialized.", "Run bun run ops setup, or use vercel login and configure project IDs. CI can supply VERCEL_TOKEN via a secret manager.", 2);
    return this.vercel;
  }
  team(path: string) { return `${path}${path.includes("?") ? "&" : "?"}${this.config.teamId ? `teamId=${encodeURIComponent(this.config.teamId)}` : ""}`; }
  async commit(ref: string): Promise<Commit> {
    const c = await this.gh.get<Commit>(`${this.root}/commits/${encodeURIComponent(ref)}`);
    if (!/^[a-f0-9]{40}$/.test(c.sha)) throw new OpsError("INVALID_RESPONSE", "GitHub did not resolve the ref to a full commit SHA.", "Check the repository and ref.");
    return c;
  }
  async artifacts(limit: number, name?: string): Promise<Artifact[]> {
    return this.gh.pages<Artifact>(`${this.root}/actions/artifacts${name ? `?name=${encodeURIComponent(name)}` : ""}`, "artifacts", limit);
  }
  async records(limit: number, env?: string, sha?: string): Promise<Deployment[]> {
    const q = new URLSearchParams({ task: "ops-record" });
    if (env) q.set("environment", env);
    if (sha) q.set("sha", sha);
    const records = await this.gh.pages<Deployment>(`${this.root}/deployments?${q}`, undefined, limit);
    return records.filter(r => {
      if (r.payload?.schemaVersion === 1) return true;
      this.warnings.push(`Deployment record ${r.id} has an unsupported schema; excluded.`); return false;
    });
  }
  async tags(env: string): Promise<{ ref: string }[]> {
    const tags = await this.gh.get<{ ref: string }[]>(`${this.root}/git/matching-refs/tags/deploy/${env}/`);
    if (!Array.isArray(tags)) throw new OpsError("INVALID_RESPONSE", "GitHub returned an invalid deployment tag list.", "Retry with --debug.");
    return tags;
  }
  async gate(sha: string): Promise<string> {
    const data = await this.gh.get<{ statuses: { context: string; state: string }[] }>(`${this.root}/commits/${sha}/status`);
    if (!Array.isArray(data.statuses)) throw new OpsError("INVALID_RESPONSE", "GitHub returned an invalid commit status response.", "Retry with --debug.");
    return data.statuses.find(s => s.context === "ci/gate-passed")?.state ?? "unknown";
  }
  async jobs(id: number, attempt?: number): Promise<Job[]> {
    return this.gh.pages<Job>(`${this.root}/actions/runs/${id}${attempt ? `/attempts/${attempt}` : ""}/jobs`, "jobs", 1000);
  }
  run(id: number) { return this.gh.get<Run>(`${this.root}/actions/runs/${id}`); }
  async runs(o: Options): Promise<Result> {
    let runs: Run[];
    if (o.active) {
      const groups = await Promise.all(["in_progress", "queued", "waiting", "pending", "requested"].map(status => this.gh.pages<Run>(`${this.root}/actions/runs?status=${status}`, "workflow_runs", o.limit)));
      runs = [...new Map(groups.flat().map(r => [r.id, r])).values()].sort((a, b) => b.id - a.id).slice(0, o.limit);
    } else {
      runs = await this.gh.pages<Run>(`${this.root}/actions/runs${o.since ? `?created=${encodeURIComponent(`>=${o.since}`)}` : ""}`, "workflow_runs", o.limit);
    }
    const rows = [];
    // Bound job API concurrency instead of issuing hundreds of requests at once.
    for (const r of runs) {
      const jobs = r.status !== "completed" ? await this.jobs(r.id, r.run_attempt) : [];
      rows.push({ run: r.id, workflow: r.name, sha: r.head_sha, branch: r.head_branch, status: r.status, conclusion: r.conclusion,
        activeJobs: jobs.filter(j => j.status !== "completed").map(j => ({ name: j.name, status: j.status, step: j.steps?.find(s => s.status === "in_progress")?.name ?? null })),
        attempt: r.run_attempt, actor: r.triggering_actor?.login ?? r.actor.login, started: r.run_started_at ?? r.created_at, url: r.html_url });
    }
    return { rows, scope: `Up to ${o.limit} workflow runs; head SHA identifies workflow execution, not necessarily the deployment target.` };
  }
  async runDetails(id: number): Promise<Result> {
    const run = await this.run(id);
    const jobs = await this.jobs(id, run.run_attempt);
    return { run: run.id, workflow: run.name, status: run.status, conclusion: run.conclusion, attempt: run.run_attempt, url: run.html_url,
      rows: jobs.map(j => ({ job: j.name, status: j.status, conclusion: j.conclusion,
        step: j.steps?.find(s => s.status === "in_progress")?.name ?? j.steps?.find(s => s.conclusion === "failure")?.name ?? null,
        started: j.started_at, completed: j.completed_at, url: j.html_url })), jobs };
  }
  async builds(o: Options): Promise<Result> {
    const [artifacts, records] = await Promise.all([this.artifacts(o.limit), this.records(1000)]);
    return { rows: artifacts.filter(a => Object.keys(this.config.apps).some(app => a.name.startsWith(`${app}-`)))
      .filter(a => !o.app || a.name.startsWith(`${o.app}-`)).filter(a => !o.since || a.created_at >= new Date(o.since).toISOString())
      .map(a => ({ app: Object.keys(this.config.apps).find(app => a.name.startsWith(`${app}-`)), artifact: a.name, id: a.id,
        uploadedAt: a.created_at, available: !a.expired && Date.parse(a.expires_at) > Date.now(), expiresAt: a.expires_at,
        run: a.workflow_run?.id, workflowSha: a.workflow_run?.head_sha, builtFrom: records.find(r => r.payload.artifactId === a.id)?.payload.builtSha ?? null, bytes: a.size_in_bytes,
        archiveDigest: a.digest, url: `https://github.com/${this.config.repository}/actions/runs/${a.workflow_run?.id}/artifacts/${a.id}` })),
      scope: `Newest ${o.limit} repository artifacts before filtering. Workflow SHA is not proof of the checked-out build SHA; inspect records for provenance.` };
  }
  async history(o: Options): Promise<Result> {
    const [records, runs, tagGroups] = await Promise.all([
      this.records(o.limit, o.env),
      Promise.all((o.env ? [o.env, "rollback"] : ["staging", "production", "rollback"]).map(kind =>
        this.gh.pages<Run>(`${this.root}/actions/workflows/cd-${kind}.yml/runs${o.since ? `?created=${encodeURIComponent(`>=${o.since}`)}` : ""}`, "workflow_runs", o.limit)))
        .then(groups => [...new Map(groups.flat().map(run => [run.id, run])).values()].sort((a, b) => b.id - a.id).slice(0, o.limit)),
      Promise.all((o.env ? [o.env] : ["staging", "production"]).map(async env => ({ env, tags: await this.tags(env) }))),
    ]);
    const deploymentTags = tagGroups.flatMap(({ env, tags }) => tags.map(t => {
      const stamp = t.ref.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
      return { environment: env, sha: t.ref.split("/").at(-1), taggedAt: stamp ? `${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}Z` : null,
        operation: t.ref.includes("/rollback/") ? "rollback" : "deploy", tag: t.ref.replace("refs/tags/", ""), evidence: "workflow success tag; per-app outcome requires records" };
    })).filter(t => !o.since || (t.taggedAt !== null && t.taggedAt >= new Date(o.since).toISOString().replace(".000Z", "Z")))
      .sort((a, b) => (b.taggedAt ?? "").localeCompare(a.taggedAt ?? "")).slice(0, o.limit);
    return { deploymentTags, rows: records.filter(r => !o.app || r.payload.app === o.app).filter(r => !o.since || r.created_at >= new Date(o.since).toISOString())
      .map(r => ({ environment: r.environment, app: r.payload.app, sha: r.sha, result: r.payload.result, health: r.payload.health,
        builtFrom: r.payload.builtSha, artifact: r.payload.artifactName, reused: r.payload.reused,
        operation: r.payload.operation, actor: r.payload.actor, recordedAt: r.created_at, run: r.payload.runId,
        attempt: r.payload.runAttempt, url: r.payload.deploymentUrl })),
      workflows: runs.filter(r => /cd-(staging|production|rollback)\.yml/.test(r.path))
        .filter(r => !o.env || r.path.includes(`cd-${o.env}.yml`) || r.path.includes("cd-rollback.yml"))
        .map(r => ({ run: r.id, workflow: r.name, title: r.display_title, status: r.status, conclusion: r.conclusion, actor: r.triggering_actor?.login ?? r.actor.login, createdAt: r.created_at, url: r.html_url })),
      scope: `Newest ${o.limit} records, runs and tags. Release tags do not prove per-app health. Workflows include attempts without records; legacy rollback environments may be unknown.` };
  }
  async status(o: Options): Promise<Result> {
    const rows: Record<string, unknown>[] = [];
    const targets = Object.entries(this.config.apps).filter(([app]) => !o.app || o.app === app)
      .flatMap(([app, value]) => (["staging", "production"] as Environment[]).filter(env => !o.env || o.env === env).map(env => ({ app, env, project: value.projects[env] })));
    const missing = targets.filter(t => t.project === undefined).map(t => `${t.app}/${t.env}`);
    const skipped = targets.filter(t => t.project === null).map(t => ({ environment: t.env, app: t.app, reason: "Skipped in setup; live deployment state is not tracked." }));
    if (missing.length) this.errors.push(this.projectConfigurationError(missing));
    const configured = targets.filter(t => t.project != null);
    const results = await Promise.allSettled(configured.map(async ({ app, env, project }) => {
      if (!project) throw new Error("Configured target is missing its project mapping");
      const api = this.requireVercel();
      const aliases = await api.pages<Alias>(this.team(`/v4/aliases?projectId=${encodeURIComponent(project.id)}`), "aliases", 1000);
      const matches = project.domain ? aliases.filter(a => a.alias === project.domain) : aliases;
      const ids = [...new Set(matches.map(a => a.deploymentId).filter(Boolean))];
      if (ids.length !== 1) {
        if (ids.length > 1) this.warnings.push(`${app}/${env}: domains point to different deployments. Run bun run ops setup --config ${JSON.stringify(this.configPath)} and select the hostname people use for this app. This does not by itself mean the app is unhealthy.`);
        return { environment: env, app, state: ids.length ? "domains-diverge" : "no-live-alias", deployedSha: null, builtFrom: null, deployedAt: null, url: project.domain ?? null, aliases: matches };
      }
      const d = await api.get<VercelDeployment>(this.team(`/v13/deployments/${encodeURIComponent(ids[0])}`));
      return { environment: env, app, state: d.readyState ?? d.state ?? "unknown", deployedSha: d.meta?.opsSelectedSha ?? null,
        builtFrom: d.meta?.opsBuiltSha ?? null, artifact: d.meta?.opsArtifactName ?? null, inputHash: d.meta?.opsInputHash ?? null,
        deployedAt: d.ready ? new Date(d.ready).toISOString() : null, createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
        deploymentId: ids[0], runId: d.meta?.opsRunId ? Number(d.meta.opsRunId) : null, runAttempt: d.meta?.opsRunAttempt ? Number(d.meta.opsRunAttempt) : null, url: `https://${project.domain ?? matches[0].alias}`, health: "not-probed", aliases: matches };
    }));
    results.forEach((result, i) => {
      if (result.status === "fulfilled") rows.push(result.value);
      else { this.errors.push(result.reason); rows.push({ environment: configured[i].env, app: configured[i].app, state: "query-failed", deployedSha: null, builtFrom: null, deployedAt: null, url: null }); }
    });
    const githubResults = await Promise.allSettled([
      this.runs({ ...o, active: true, limit: Math.min(o.limit, 5) }),
      this.records(200, o.env),
    ]);
    const activity = githubResults[0].status === "fulfilled" ? githubResults[0].value.rows : [];
    const records = githubResults[1].status === "fulfilled" ? githubResults[1].value : [];
    for (const result of githubResults) if (result.status === "rejected") this.errors.push(result.reason);
    for (const row of rows) {
      if (row.runId) {
        const record = records.find(r => r.payload.runId === row.runId && r.payload.runAttempt === row.runAttempt && r.payload.app === row.app && r.environment === row.environment);
        row.lastRecordedHealth = record?.payload.health ?? "unknown";
        row.healthRecordedAt = record?.created_at ?? null;
      }
    }
    const backend = (["staging", "production"] as Environment[]).filter(env => !o.env || o.env === env).map(env => {
      const attempts = records.filter(r => r.environment === env && r.payload.app === "backend");
      const success = attempts.find(r => r.payload.result === "success");
      return { environment: env, lastRecordedSuccess: success?.sha ?? null, lastRecordedAt: success?.created_at ?? null,
        latestAttempt: attempts[0]?.payload.result ?? "unknown", evidence: "GitHub workflow records; not a live Convex probe" };
    });
    return { rows, ...(skipped.length ? { skipped } : {}), activity, backend, note: "Current domain targets from configured Vercel projects. Deployment readiness is not application health. Missing metadata is unknown. Explicitly skipped targets are not tracked; absent mappings are configuration errors." };
  }
  async candidates(o: Options): Promise<Result> {
    const tags = await this.tags("staging");
    const stamp = (ref: string) => ref.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/)?.[0] ?? "";
    const seen = new Set<string>();
    const unique = tags.sort((a, b) => stamp(b.ref).localeCompare(stamp(a.ref))).filter(t => {
      const sha = t.ref.split("/").at(-1)!;
      if (seen.has(sha)) return false;
      seen.add(sha); return true;
    }).slice(0, o.limit);
    const [records, artifacts] = await Promise.all([this.records(1000, "staging"), this.artifacts(1000)]);
    const rows = [];
    for (const tag of unique) {
      const sha = tag.ref.split("/").at(-1)!;
      if (!/^[a-f0-9]{40}$/.test(sha)) { this.warnings.push(`Unrecognized legacy tag ${tag.ref}; excluded.`); continue; }
      const [c, gate] = await Promise.all([this.commit(sha), this.gate(sha)]);
      const evidence = records.filter(r => r.sha === sha && r.payload.artifactName);
      const available = [...new Set(evidence.filter(r => artifacts.some(a => a.id === r.payload.artifactId && !a.expired && Date.parse(a.expires_at) > Date.now())).map(r => r.payload.app))];
      rows.push({ sha, artifactsAvailable: available.join(", ") || "unknown (inspect SHA)", change: c.commit.message.split("\n")[0], ci: gate, stagingTag: tag.ref.replace("refs/tags/", ""),
        eligibility: gate === "success" ? "workflow-gates-pass" : "blocked", reason: gate === "success" ? "Inspect artifact availability before deploying; builds may be required." : `CI gate is ${gate}`, url: c.html_url });
    }
    return { rows, target: o.to ?? "production", note: "Eligibility reflects staging-tag and CI gates, not a guarantee of successful deployment or available artifacts." };
  }
  async inspect(ref: string, o: Options): Promise<Result> {
    const commit = await this.commit(ref);
    const [tags, gate, records] = await Promise.all([this.tags("staging"), this.gate(commit.sha), this.records(1000, undefined, commit.sha)]);
    const stagingTag = tags.some(t => t.ref.endsWith(`/${commit.sha}`));
    const target = o.to ?? "production";
    const rows = [];
    for (const app of Object.keys(this.config.apps)) {
      if (o.app && o.app !== app) continue;
      const candidates = records.filter(r => r.sha === commit.sha && r.payload.app === app && r.environment === target && r.payload.inputHash && r.payload.artifactName === `${app}-${r.payload.inputHash}`);
      const record = candidates[0]?.payload;
      const available = record?.artifactName ? await this.artifacts(100, record.artifactName) : [];
      const artifact = available.find(a => a.name === record?.artifactName && !a.expired && Date.parse(a.expires_at) > Date.now());
      rows.push({ app, action: artifact ? "reuse-recorded-artifact" : record ? "build-required" : "resolve-at-deploy",
        artifact: record?.artifactName ?? null, artifactId: artifact?.id ?? null, builtFrom: artifact?.id === record?.artifactId ? record?.builtSha ?? null : null,
        inputHash: record?.inputHash ?? null, checksum: artifact?.id === record?.artifactId ? record?.checksum ?? null : null, expiresAt: artifact?.expires_at ?? null,
        evidence: record ? `run ${record.runId}, attempt ${record.runAttempt}${artifact && artifact.id !== record.artifactId ? "; replacement artifact: provenance unknown until verified" : ""}` : `No recorded ${target} input hash for this commit; the workflow will resolve it at deploy time.` });
    }
    const backend = records.find(r => r.payload.app === "backend");
    rows.push({ app: "backend", action: "deploy-source-and-migrations", artifact: null, artifactId: null, builtFrom: commit.sha, inputHash: null, checksum: null, expiresAt: null, evidence: backend ? `Recorded result: ${backend.payload.result}; this is not a live backend probe.` : "No recorded backend result." });
    return { sha: commit.sha, change: commit.commit.message, target, ci: gate, stagingTag,
      eligible: target === "staging" || (stagingTag && gate === "success"), rows,
      note: "Artifact reuse is based on recorded target-environment input hashes; the workflow recomputes the hash with current configuration. Available bytes are not an attestation verification." };
  }
  async diff(from: string, to: string, o: Options): Promise<Result> {
    const commit = await this.commit(to);
    let bases: { app: string; sha: string }[];
    if (["staging", "production"].includes(from)) {
      const state = await this.status({ ...o, env: from });
      bases = (state.rows ?? []).filter(r => typeof r.deployedSha === "string").map(r => ({ app: String(r.app), sha: String(r.deployedSha) }));
      if (!bases.length || bases.length !== state.rows?.length) this.errors.push(new OpsError("UNKNOWN_BASE", "Some current SHAs are unknown or not tracked; their diffs cannot be calculated.", "Configure project mappings and deploy using the instrumented workflows, or compare two explicit SHAs.", 3));
    } else bases = [{ app: "repository", sha: (await this.commit(from)).sha }];
    const rows = [];
    for (const base of bases) {
      const compare = await this.gh.get<{ status: string; ahead_by: number; behind_by: number; total_commits: number; html_url: string; commits: Commit[]; files?: { filename: string; status: string }[] }>(`${this.root}/compare/${base.sha}...${commit.sha}`);
      rows.push({ app: base.app, from: base.sha, to: commit.sha, relationship: compare.status, ahead: compare.ahead_by, behind: compare.behind_by,
        totalCommits: compare.total_commits, url: compare.html_url, commits: compare.commits.map(c => ({ sha: c.sha, message: c.commit.message.split("\n")[0] })), files: compare.files ?? [] });
    }
    return { rows, note: "Repository comparisons per app's deployed commit. GitHub limits inline commit/file lists; the comparison link contains the full view." };
  }
  async projects(): Promise<Result> {
    const projects = await this.requireVercel().pages<{ id: string; name: string }>(this.team("/v9/projects"), "projects", 1000);
    return { rows: projects.map(p => ({ name: p.name, id: p.id })), note: "Assign project IDs to app/environment pairs in ops.config.json; Vercel production target alone does not identify staging." };
  }
  async dispatch(ref: string, o: Options): Promise<Result> {
    if (!/^[a-f0-9]{7,40}$/i.test(ref)) usage("Deployment requires an explicit commit SHA (7–40 hexadecimal characters), not a mutable branch.");
    if (o.to && o.env && o.to !== o.env) usage("--to and --env must agree.");
    const target = (o.to ?? o.env) as Environment | undefined;
    if (!target) usage("Specify --to staging or --to production.");
    const commit = await this.commit(ref);
    const rollback = o.command === "rollback";
    if (rollback) {
      const tags = await this.tags(target);
      if (!tags.some(t => t.ref.endsWith(`/${commit.sha}`))) throw new OpsError("INELIGIBLE", `No previous ${target} deployment tag exists for ${commit.sha}.`, "Choose a SHA from ops history.", 2);
    } else if (target === "production") {
      const info = await this.inspect(commit.sha, o);
      if (!info.eligible) throw new OpsError("INELIGIBLE", `${commit.sha} does not pass production deployment gates.`, "Deploy to staging and ensure ci/gate-passed succeeds first.", 2, { ci: info.ci, stagingTag: info.stagingTag });
    }
    const workflow = rollback ? "cd-rollback.yml" : `cd-${target}.yml`;
    const workflowRef = o.ref ?? this.config.workflowRef;
    const requestId = crypto.randomUUID();
    const inputs: Record<string, string> = rollback ? { target_sha: commit.sha, environment: target, confirm: `rollback-${target}`, request_id: requestId }
      : target === "production" ? { git_sha: commit.sha, confirm: "deploy-production", request_id: requestId }
      : { git_sha: commit.sha, force_deploy: "true", request_id: requestId };
    const plan = { repository: this.config.repository, workflow, workflowRef, sha: commit.sha, environment: target, requestId, inputs,
      workflowUrl: `https://github.com/${this.config.repository}/actions/workflows/${workflow}` };
    if (o.dryRun) return { ...plan, dispatched: false, note: "Dry run: gates checked; no write request sent. Workflow will resolve/build artifacts and deploy the backend." };
    if (!o.yes) throw new OpsError("CONFIRMATION_REQUIRED", `Ready to ${rollback ? "roll back" : "deploy"} ${commit.sha} to ${target}.`, "Review --dry-run, then repeat with --yes to dispatch the workflow.", 2, plan);
    try { await this.gh.post(`${this.root}/actions/workflows/${workflow}/dispatches`, { ref: workflowRef, inputs }); }
    catch (cause) {
      if (cause instanceof OpsError) { cause.details = { ...cause.details, requestId, workflowUrl: plan.workflowUrl }; throw cause; }
      throw cause;
    }
    return { ...plan, dispatched: true, note: "Request accepted. Use ops runs to follow it; this does not mean deployment succeeded." };
  }
  async findDispatchedRun(workflow: string, requestId: string): Promise<Run | undefined> {
    const runs = await this.gh.pages<Run>(`${this.root}/actions/workflows/${workflow}/runs?event=workflow_dispatch`, "workflow_runs", 100);
    return runs.find(r => r.display_title.includes(`[ops:${requestId}]`));
  }
}
