import { artifactApp, deployedApps, fullSha, parallel, resolveTag, safeUrl, type TagRef, type DeploymentTag } from "./evidence";
import { assertAttempt, diagnose, runEnvironment, verifyServing } from "./journeys";
import { candidateEvidence, type PushArtifact } from "./candidate-evidence";
import { OpsError, usage } from "./errors";
import type { Api, Artifact, Commit, Config, Deployment, Environment, Job, Result, Run, VercelDeployment, Alias, Coverage } from "./types";
import type { Options } from "./options";

export class OpsService {
  errors: unknown[] = [];
  warnings: string[] = [];
  coverage: Coverage[] = [];
  async read<T>(source: string, operation: () => Promise<T>, fallback: T): Promise<T> {
    try { return await operation(); }
    catch (error) { this.errors.push(error); this.coverage.push({ source, state: "unavailable", count: 0 }); return fallback; }
  }
  async pages<T>(api: Api, path: string, key?: string, limit = 1000): Promise<T[]> {
    return this.read(path, () => api.pages<T>(path, key, limit, (coverage, error) => {
      this.coverage.push(coverage); if (error) this.errors.push(error);
    }), []);
  }
  requireEvidence() {
    if (this.errors.length) throw new OpsError("EVIDENCE_INCOMPLETE", "Required evidence could not be read or is conflicting.", "Resolve the reported evidence errors before dispatching.", 3);
  }
  diagnose(id: number, o: Options) { return diagnose(this, id, o); }
  verify(id: number, o: Options) { return verifyServing(this, id, o); }

  readonly root: string;
  constructor(readonly config: Config, readonly gh: Api, readonly vercel?: Api, readonly configPath = "ops.config.json") { this.root = `/repos/${config.repository}`; }
  projectConfigurationError(missing: string[]): OpsError {
    return new OpsError("CONFIG_MISSING",
      `Configuration missing: Vercel project mappings are missing for ${missing.join(", ")}. Live deployment state was not queried for these targets.`,
      `Run bun run ops setup --config ${JSON.stringify(this.configPath)} for guided login, team discovery and project mapping.\n` +
      `Manual setup: create ${this.configPath} from ops.config.example.json, then run gh auth login and vercel login.\n` +
      "Run bun run ops teams to find teamId, then bun run ops projects --team TEAM_ID to find project IDs.\n" +
      "Fill apps.<app>.projects.<environment>.id for the missing targets, then rerun the command. CI can supply VERCEL_TOKEN via a secret manager.\n" +
      "See platform/docs/ops-cli.md for the setup walkthrough.",
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
    return this.pages<Artifact>(this.gh, `${this.root}/actions/artifacts${name ? `?name=${encodeURIComponent(name)}` : ""}`, "artifacts", limit);
  }
  async records(limit: number, env?: string, sha?: string): Promise<Deployment[]> {
    const q = new URLSearchParams({ task: "ops-record" });
    if (env) q.set("environment", env);
    if (sha) q.set("sha", sha);
    const records = await this.pages<Deployment>(this.gh, `${this.root}/deployments?${q}`, undefined, limit);
    return records.filter(r => {
      if (r.payload?.schemaVersion === 1) return true;
      this.warnings.push(`Deployment record ${r.id} has an unsupported schema; excluded.`); return false;
    });
  }
  async tags(env: string, limit = 1000, sha?: string): Promise<DeploymentTag[]> {
    return this.read(`tags/${env}`, async () => {
      const refs = await this.gh.get<TagRef[]>(`${this.root}/git/matching-refs/tags/deploy/${env}/`);
      if (!Array.isArray(refs)) throw new OpsError("INVALID_RESPONSE", "GitHub returned an invalid deployment tag list.", "Retry with --debug.");
      const matching = refs.filter(t => !sha || t.ref.endsWith(`/${sha}`)).sort((a, b) => {
        const stamp = (ref: string) => ref.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/)?.[0] ?? "";
        return stamp(b.ref).localeCompare(stamp(a.ref));
      });
      this.coverage.push({ source: `tags/${env}`, state: matching.length > limit ? "windowed" : "complete", count: Math.min(matching.length, limit), limit });
      const tags = await parallel(matching.slice(0, limit), tag => this.read(tag.ref, () => resolveTag(this.gh, this.root, tag), null));
      return tags.filter((tag): tag is DeploymentTag => tag !== null);
    }, []);
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
    const before = this.errors.length;
    let runs: Run[];
    if (o.active) {
      const groups = await Promise.all(["in_progress", "queued", "waiting", "pending", "requested"].map(status => this.pages<Run>(this.gh, `${this.root}/actions/runs?status=${status}`, "workflow_runs", o.limit)));
      runs = [...new Map(groups.flat().map(r => [r.id, r])).values()].sort((a, b) => b.id - a.id).slice(0, o.limit);
    } else {
      runs = await this.pages<Run>(this.gh, `${this.root}/actions/runs${o.since ? `?created=${encodeURIComponent(`>=${o.since}`)}` : ""}`, "workflow_runs", o.limit);
    }
    const rows = await parallel(runs, async r => {
      const jobs = r.status !== "completed" ? await this.read(`jobs/${r.id}`, () => this.jobs(r.id, r.run_attempt), []) : [];
      return { run: r.id, workflow: r.name, environment: runEnvironment(r, []) ?? "unknown", sha: r.head_sha, branch: r.head_branch, status: r.status, conclusion: r.conclusion,
        activeJobs: jobs.filter(j => j.status !== "completed").map(j => ({ name: j.name, status: j.status, step: j.steps?.find(s => s.status === "in_progress")?.name ?? null })),
        attempt: r.run_attempt, actor: r.triggering_actor?.login ?? r.actor.login, started: r.run_started_at ?? r.created_at, url: r.html_url };
    });
    if (!rows.length && this.errors.length > before) throw this.errors[before];
    return { rows, scope: `Up to ${o.limit} workflow runs; head SHA identifies workflow execution, not necessarily the deployment target.` };
  }
  async runDetails(id: number, attempt?: number): Promise<Result> {
    const run = await this.run(id); assertAttempt(run, attempt);
    const jobs = await this.jobs(id, run.run_attempt);
    return { run: run.id, workflow: run.name, path: run.path, status: run.status, conclusion: run.conclusion, attempt: run.run_attempt, url: run.html_url,
      rows: jobs.map(j => ({ job: j.name, status: j.status, conclusion: j.conclusion,
        step: j.steps?.find(s => s.status === "in_progress")?.name ?? j.steps?.find(s => s.conclusion === "failure")?.name ?? null,
        started: j.started_at, completed: j.completed_at, url: j.html_url })), jobs };
  }
  async builds(o: Options): Promise<Result> {
    const [artifacts, records] = await Promise.all([this.artifacts(o.limit), this.records(1000)]);
    return { rows: artifacts.filter(a => artifactApp(a.name, Object.keys(this.config.apps)))
      .filter(a => !o.app || artifactApp(a.name, Object.keys(this.config.apps)) === o.app).filter(a => !o.since || a.created_at >= new Date(o.since).toISOString())
      .map(a => ({ app: artifactApp(a.name, Object.keys(this.config.apps)), artifact: a.name, id: a.id,
        uploadedAt: a.created_at, available: !a.expired && Date.parse(a.expires_at) > Date.now(), expiresAt: a.expires_at,
        run: a.workflow_run?.id, workflowSha: a.workflow_run?.head_sha, builtFrom: records.find(r => r.payload.artifactId === a.id)?.payload.builtSha ?? null, bytes: a.size_in_bytes,
        archiveDigest: a.digest, url: `https://github.com/${this.config.repository}/actions/runs/${a.workflow_run?.id}/artifacts/${a.id}` })),
      scope: `Newest ${o.limit} repository artifacts before filtering to current-format app packages (<app>-<16-character input hash>). Workflow SHA is not proof of the checked-out build SHA; inspect records for provenance.` };
  }
  async history(o: Options): Promise<Result> {
    const [records, runs, tagGroups] = await Promise.all([
      Promise.all((o.env ? [o.env] : ["staging", "production"]).map(env => this.records(o.limit, env))).then(groups => groups.flat()),
      Promise.all((o.env ? [o.env, "rollback"] : ["staging", "production", "rollback"]).map(kind =>
        this.pages<Run>(this.gh, `${this.root}/actions/workflows/cd-${kind}.yml/runs${o.since ? `?created=${encodeURIComponent(`>=${o.since}`)}` : ""}`, "workflow_runs", o.limit)))
        .then(groups => [...new Map(groups.flat().map(run => [run.id, run])).values()].sort((a, b) => b.id - a.id)),
      Promise.all((o.env ? [o.env] : ["staging", "production"]).map(async env => ({ env, tags: await this.tags(env, o.limit) }))),
    ]);
    const deploymentTags = tagGroups.flatMap(({ env, tags }) => tags.map(t => {
      const stamp = t.ref.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
      return { environment: env, sha: t.sha, run: t.runId, url: t.runId ? `https://github.com/${this.config.repository}/actions/runs/${t.runId}` : `https://github.com/${this.config.repository}/tree/${encodeURIComponent(t.ref.replace("refs/tags/", ""))}`, taggedAt: stamp ? `${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}Z` : null,
        operation: t.ref.includes("/rollback/") ? "rollback" : "deploy", tag: t.ref.replace("refs/tags/", ""), evidence: "workflow success tag; per-app outcome requires records" };
    })).filter(t => !o.since || (t.taggedAt !== null && t.taggedAt >= new Date(o.since).toISOString().replace(".000Z", "Z")))
      .sort((a, b) => (b.taggedAt ?? "").localeCompare(a.taggedAt ?? ""));
    for (const tag of deploymentTags) {
      if (tag.run && !runs.some(r => r.id === tag.run)) {
        const run = await this.read(`tag-run/${tag.run}`, () => this.run(tag.run!), null);
        if (run) runs.push(run);
      }
    }
    return { deploymentTags, rows: records.filter(r => !o.app || r.payload.app === o.app).filter(r => !o.since || r.created_at >= new Date(o.since).toISOString())
      .map(r => ({ environment: r.environment, app: r.payload.app, sha: r.sha, result: r.payload.result, health: r.payload.health,
        builtFrom: r.payload.builtSha, artifact: r.payload.artifactName, reused: r.payload.reused,
        operation: r.payload.operation, actor: r.payload.actor, recordedAt: r.created_at, run: r.payload.runId,
        attempt: r.payload.runAttempt, url: r.payload.deploymentUrl })),
      workflows: runs.filter(r => /cd-(staging|production|rollback)\.yml/.test(r.path))
        .filter(r => !o.env || r.path.includes(`cd-${o.env}.yml`) || r.path.includes("cd-rollback.yml"))
        .map(r => ({ run: r.id, workflow: r.name, title: r.display_title, status: r.status, conclusion: r.conclusion, actor: r.triggering_actor?.login ?? r.actor.login, createdAt: r.created_at, url: r.html_url })),
      scope: `Newest ${o.limit} records, runs and tags. Release tags do not prove per-app health. Workflows include attempts without records; rollback environments require per-run records.` };
  }
  async status(o: Options, includeActivity = true): Promise<Result> {
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
      const aliases = await api.pages<Alias>(this.team(`/v4/aliases?projectId=${encodeURIComponent(project.id)}`), "aliases", 1000, (coverage, error) => {
        this.coverage.push(coverage);
        if (error) throw error;
        if (coverage.state === "windowed" && !project.domain) throw new OpsError("ALIAS_WINDOW", "The complete alias set could not be inspected.", "Select a canonical hostname in ops setup or inspect the remaining aliases before verifying all-domain serving state.", 3);
      });
      const matches = project.domain ? aliases.filter(a => a.alias === project.domain) : aliases;
      if (matches.some(alias => !alias.deploymentId)) throw new OpsError("ALIAS_UNKNOWN", "A tracked alias has no deployment identity.", "Inspect the project domains and retry verification.", 3);
      const ids = [...new Set(matches.map(a => a.deploymentId).filter(Boolean))];
      if (ids.length !== 1) {
        if (ids.length > 1) this.warnings.push(`${app}/${env}: domains point to different deployments. Run bun run ops setup --config ${JSON.stringify(this.configPath)} and select the hostname people use for this app. This does not by itself mean the app is unhealthy.`);
        return { environment: env, app, state: ids.length ? "domains-diverge" : "no-live-alias", deployedSha: null, builtFrom: null, deployedAt: null, url: project.domain ?? null, aliases: matches };
      }
      const d = await api.get<VercelDeployment>(this.team(`/v13/deployments/${encodeURIComponent(ids[0])}`));
      return { environment: env, app, state: d.readyState ?? d.state ?? "unknown", deployedSha: d.meta?.opsSelectedSha ?? null,
        builtFrom: d.meta?.opsBuiltSha ?? null, artifact: d.meta?.opsArtifactName ?? null, inputHash: d.meta?.opsInputHash ?? null,
        deployedAt: d.ready ? new Date(d.ready).toISOString() : null, createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
        projectId: project.id, deploymentUrl: safeUrl(d.url?.startsWith("https://") ? d.url : `https://${d.url}`), deploymentId: ids[0], runId: d.meta?.opsRunId ? Number(d.meta.opsRunId) : null, runAttempt: d.meta?.opsRunAttempt ? Number(d.meta.opsRunAttempt) : null, url: `https://${project.domain ?? matches[0].alias}`, health: "not-probed", aliases: matches };
    }));
    results.forEach((result, i) => {
      if (result.status === "fulfilled") rows.push(result.value);
      else { this.errors.push(result.reason); rows.push({ environment: configured[i].env, app: configured[i].app, state: "query-failed", deployedSha: null, builtFrom: null, deployedAt: null, url: null }); }
    });
    const githubResults = await Promise.allSettled([
      includeActivity ? this.runs({ ...o, active: true, limit: Math.min(o.limit, 20) }) : Promise.resolve({ rows: [] }),
      this.records(200, o.env),
    ]);
    let activity = githubResults[0].status === "fulfilled" ? githubResults[0].value.rows : [];
    const records = githubResults[1].status === "fulfilled" ? githubResults[1].value : [];
    for (const result of githubResults) if (result.status === "rejected") this.errors.push(result.reason);
    for (const row of rows) {
      if (row.runId) {
        const record = records.find(r => r.payload.runId === row.runId && r.payload.runAttempt === row.runAttempt && r.payload.app === row.app && r.environment === row.environment);
        row.lastRecordedHealth = record?.payload.health ?? "unknown";
        row.healthRecordedAt = record?.created_at ?? null;
      }
    }
    const recentRuns = includeActivity ? await this.deploymentRuns({ ...o, limit: 3 }) : [];
    const recentOperations = recentRuns.map(run => ({ run: run.id, attempt: run.run_attempt, workflow: run.name,
      environment: runEnvironment(run, records) ?? "unknown", status: run.status, conclusion: run.conclusion,
      createdAt: run.created_at, url: safeUrl(run.html_url), next: `ops diagnose ${run.id} --attempt ${run.run_attempt}` }));
    if (o.env) activity = activity?.filter(r => r.environment === o.env || r.environment === "unknown");
    for (const row of rows) {
      const latest = records.filter(r => r.environment === row.environment && r.payload.app === row.app).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      row.latestAttempt = latest?.payload.result ?? "unknown";
      row.latestAttemptSha = latest?.sha ?? null;
      row.latestAttemptRun = latest?.payload.runId ?? null;
      row.next = latest && !["success", "unchanged"].includes(latest.payload.result ?? "") ? `ops diagnose ${latest.payload.runId}` : null;
    }
    const backend = (["staging", "production"] as Environment[]).filter(env => !o.env || o.env === env).map(env => {
      const attempts = records.filter(r => r.environment === env && r.payload.app === "backend");
      const success = attempts.find(r => r.payload.result === "success");
      return { environment: env, lastRecordedSuccess: success?.sha ?? null, lastRecordedAt: success?.created_at ?? null,
        latestAttempt: attempts[0]?.payload.result ?? "unknown", evidence: "GitHub workflow records; not a live Convex probe" };
    });
    return { rows, ...(skipped.length ? { skipped } : {}), activity, backend, recentOperations, note: "Current domain targets from configured Vercel projects. Deployment readiness is not application health. Missing metadata is unknown. Explicitly skipped targets are not tracked; absent mappings are configuration errors." };
  }
  async deploymentRuns(o: Options): Promise<Run[]> {
    const kinds = o.env ? [o.env, "rollback"] : ["staging", "production", "rollback"];
    const groups = await parallel(kinds, kind => this.pages<Run>(this.gh, `${this.root}/actions/workflows/cd-${kind}.yml/runs`, "workflow_runs", o.limit));
    return [...new Map(groups.flat().map(run => [run.id, run])).values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async releasePreview(ref: string, o: Options): Promise<Result> {
    const plan = await this.inspect(ref, o);
    const current = await this.status({ ...o, env: o.to ?? "production" });
    const changes = await parallel(current.rows ?? [], async row => {
      if (typeof row.deployedSha !== "string") return { app: row.app, state: "unknown base" };
      const comparison = await this.read(`compare/${row.app}`, () => this.gh.get<{ ahead_by: number; behind_by: number; html_url: string; files?: { filename: string }[] }>(`${this.root}/compare/${row.deployedSha}...${plan.sha}`), null);
      return { app: row.app, from: row.deployedSha, to: plan.sha, ahead: comparison?.ahead_by, behind: comparison?.behind_by,
        backendChanges: comparison?.files?.filter(f => f.filename.startsWith("packages/backend/")).map(f => f.filename) ?? [], url: safeUrl(comparison?.html_url) };
    });
    return { ...plan, current: current.rows, changes, activity: current.activity, skipped: current.skipped,
      deploymentScope: "web, admin, landing, backend and migrations. Monitoring selections do not change workflow destinations.",
      completion: "Workflow success and intended frontend deployments serving configured domains; backend uses workflow evidence.",
      migrationNote: "Changed backend files require compatibility review; this CLI does not prove database compatibility or restore data." };
  }
  async candidates(o: Options): Promise<Result> {
    if (o.to === "staging") return this.stagingCandidates(o);
    const tags = await this.tags("staging", o.limit);
    const stamp = (ref: string) => ref.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/)?.[0] ?? "";
    const seen = new Set<string>();
    const unique = tags.sort((a, b) => stamp(b.ref).localeCompare(stamp(a.ref))).filter(t => {
      const sha = t.ref.split("/").at(-1)!;
      if (seen.has(sha)) return false;
      seen.add(sha); return true;
    }).slice(0, o.limit);
    const [records, artifacts] = await Promise.all([this.records(1000, "staging"), this.artifacts(1000)]);
    const pushArtifacts = await this.candidateArtifactSources(artifacts, unique.map(tag => tag.sha));
    const rows = [];
    for (const tag of unique) {
      const sha = tag.ref.split("/").at(-1)!;
      if (!/^[a-f0-9]{40}$/.test(sha)) { this.warnings.push(`Invalid deployment tag ${tag.ref}; excluded.`); continue; }
      const [c, gate] = await Promise.all([this.read(`commit/${sha}`, () => this.commit(sha), null), this.read(`gate/${sha}`, () => this.gate(sha), "unknown")]);
      rows.push({ sha, change: c?.commit.message.split("\n")[0] ?? "unknown", ci: gate, stagingTag: tag.ref.replace("refs/tags/", ""),
        ...candidateEvidence(sha, records, artifacts, true, pushArtifacts),
        eligibility: gate === "success" ? "workflow-gates-pass" : gate === "unknown" ? "insufficient-evidence" : "blocked", reason: gate === "success" ? "Inspect artifact availability before deploying; builds may be required." : `CI gate is ${gate}`, url: c?.html_url });
    }
    return { rows, target: o.to ?? "production", note: "Eligibility reflects staging-tag and CI gates, not a guarantee of successful deployment or available artifacts." };
  }
  async candidateArtifactSources(artifacts: Artifact[], shas: string[]): Promise<PushArtifact[]> {
    const wanted = new Set(shas);
    const candidates = artifacts.filter(a => artifactApp(a.name, [...deployedApps]) && !a.expired && Date.parse(a.expires_at) > Date.now()
      && a.workflow_run && wanted.has(a.workflow_run.head_sha));
    const runs = await parallel([...new Set(candidates.map(a => a.workflow_run!.id))], id => this.read(`artifact-run/${id}`, () => this.run(id), null));
    return candidates.flatMap(artifact => {
      const run = runs.find(r => r?.id === artifact.workflow_run!.id);
      // A workflow_dispatch head SHA identifies workflow code, not its git_sha
      // input. Only our staging push workflow supplies an unambiguous upload association.
      if (!run || run.event !== "push" || run.path.split("@")[0] !== ".github/workflows/cd-staging.yml"
        || run.head_sha !== artifact.workflow_run!.head_sha) return [];
      return [{ artifact, sha: run.head_sha, run: run.id, url: `https://github.com/${this.config.repository}/actions/runs/${run.id}/artifacts/${artifact.id}` }];
    });
  }
  async candidateUploadEvidence(sha: string): Promise<{ sources: PushArtifact[]; complete: boolean }> {
    // A capped repository catalog cannot prove absence. Check this commit's
    // staging push runs and exhaust each run's own artifact list instead.
    let complete = true;
    const pages = async <T>(path: string, key: string) => {
      try {
        return await this.gh.pages<T>(path, key, 1000, (coverage, error) => {
          this.coverage.push(coverage);
          if (coverage.state !== "complete") complete = false;
          if (error) this.errors.push(error);
        });
      } catch (error) {
        complete = false; this.errors.push(error);
        this.coverage.push({ source: path, state: "unavailable", count: 0 });
        return [];
      }
    };
    const runs = await pages<Run>(`${this.root}/actions/workflows/cd-staging.yml/runs?head_sha=${sha}&event=push`, "workflow_runs");
    const sources: PushArtifact[] = [];
    for (const run of runs) {
      if (run.head_sha !== sha || run.event !== "push" || run.path.split("@")[0] !== ".github/workflows/cd-staging.yml") { complete = false; continue; }
      if (run.status !== "completed") complete = false;
      const artifacts = await pages<Artifact>(`${this.root}/actions/runs/${run.id}/artifacts`, "artifacts");
      for (const artifact of artifacts) {
        if (!artifactApp(artifact.name, [...deployedApps])) continue;
        sources.push({ artifact, sha, run: run.id, url: `https://github.com/${this.config.repository}/actions/runs/${run.id}/artifacts/${artifact.id}` });
      }
    }
    return { sources, complete };
  }
  async stagingCandidates(o: Options): Promise<Result> {
    const repository = await this.gh.get<{ default_branch: string }>(this.root);
    const branch = repository.default_branch;
    if (typeof branch !== "string" || !branch) throw new OpsError("INVALID_RESPONSE", "GitHub did not report the repository's default branch.", "Retry or enter an explicit commit SHA to review.");
    const [commits, records, artifacts] = await Promise.all([
      this.pages<Commit>(this.gh, `${this.root}/commits?sha=${encodeURIComponent(branch)}`, undefined, o.limit),
      this.records(1000, "staging"), this.artifacts(1000),
    ]);
    const artifactsReadable = !this.coverage.some(c => c.source.includes("/actions/artifacts") && ["partial", "unavailable"].includes(c.state));
    const seen = new Set<string>();
    const unique = commits.filter(c => {
      if (!fullSha(c.sha) || seen.has(c.sha)) return false;
      seen.add(c.sha); return true;
    });
    const pushArtifacts = await this.candidateArtifactSources(artifacts, unique.map(c => c.sha));
    const rows = await parallel(unique, async c => {
      const ci = await this.read(`gate/${c.sha}`, () => this.gate(c.sha), "unavailable");
      const preliminary = candidateEvidence(c.sha, records, artifacts, artifactsReadable, pushArtifacts);
      const uploads = preliminary.appEvidence.some(a => a.app !== "backend" && a.artifactState === "unknown")
        ? await this.candidateUploadEvidence(c.sha) : undefined;
      return { sha: c.sha, change: c.commit.message.split("\n")[0], branch, ci,
        ...candidateEvidence(c.sha, records, artifacts, artifactsReadable, [...pushArtifacts, ...(uploads?.sources ?? [])], uploads?.complete ?? false),
        committedAt: c.commit.author.date, url: safeUrl(c.html_url) };
    });
    const visible = rows.filter(row => row.hasProducedArtifacts || o.allCommits);
    return { rows: visible, target: "staging", sourceBranch: branch,
      hiddenWithoutProducedArtifacts: rows.length - visible.length,
      note: `Recent commits on ${branch} that produced available app packages, newest first. --all-commits also shows reuse-only, unknown, expired and unchanged commits. Labels distinguish recorded new/reused artifacts from uploads associated with staging push runs; availability does not establish a match with current environment inputs. CI is the last reported overall gate; staging reruns it before deploying.` };
  }
  async inspect(ref: string, o: Options): Promise<Result> {
    const commit = await this.commit(ref);
    const [tags, gate, records] = await Promise.all([this.tags("staging", 1000, commit.sha), this.gate(commit.sha), this.records(1000, undefined, commit.sha)]);
    const stagingTag = tags.some(t => t.ref.endsWith(`/${commit.sha}`));
    const target = o.to ?? "production";
    const rows = [];
    for (const app of deployedApps) {
      if (o.app && o.app !== app) continue;
      const candidates = records.filter(r => r.sha === commit.sha && r.payload.app === app && r.environment === target && r.payload.inputHash
        && r.payload.artifactName === `${app}-${r.payload.inputHash}` && artifactApp(r.payload.artifactName, [...deployedApps]) === app);
      const record = candidates[0]?.payload;
      const errorsBeforeLookup = this.errors.length;
      const coverageBeforeLookup = this.coverage.length;
      const available = record?.artifactName ? await this.artifacts(100, record.artifactName) : [];
      const availabilityUnknown = this.errors.length > errorsBeforeLookup || this.coverage.slice(coverageBeforeLookup).some(c => c.state !== "complete");
      const artifact = available.find(a => a.name === record?.artifactName && !a.expired && Date.parse(a.expires_at) > Date.now());
      rows.push({ app, action: artifact ? "reuse-recorded-artifact" : record && !availabilityUnknown ? "build-required" : "resolve-at-deploy",
        artifact: record?.artifactName ?? null, artifactId: artifact?.id ?? null, builtFrom: artifact?.id === record?.artifactId ? record?.builtSha ?? null : null,
        inputHash: record?.inputHash ?? null, checksum: artifact?.id === record?.artifactId ? record?.checksum ?? null : null, expiresAt: artifact?.expires_at ?? null,
        evidence: availabilityUnknown ? "Artifact availability could not be checked; this is not evidence that a build is required." : record ? `run ${record.runId}, attempt ${record.runAttempt}${artifact && artifact.id !== record.artifactId ? "; replacement artifact: provenance unknown until verified" : ""}` : `No recorded ${target} input hash for this commit; the workflow will resolve it at deploy time.` });
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
      const tags = await this.tags(target, 1000, commit.sha);
      if (!tags.some(t => t.ref.endsWith(`/${commit.sha}`))) throw new OpsError("INELIGIBLE", `No previous ${target} deployment tag exists for ${commit.sha}.`, "Choose a SHA from ops history.", 2);
    } else if (target === "production") {
      const info = await this.inspect(commit.sha, o);
      if (!info.eligible) throw new OpsError("INELIGIBLE", `${commit.sha} does not pass production deployment gates.`, "Deploy to staging and ensure ci/gate-passed succeeds first.", 2, { ci: info.ci, stagingTag: info.stagingTag });
    }
    this.requireEvidence();
    const workflow = rollback ? "cd-rollback.yml" : `cd-${target}.yml`;
    const workflowRef = o.ref ?? this.config.workflowRef;
    const requestId = o.request ?? crypto.randomUUID();
    const inputs: Record<string, string> = rollback ? { target_sha: commit.sha, environment: target, confirm: `rollback-${target}`, request_id: requestId }
      : target === "production" ? { git_sha: commit.sha, confirm: "deploy-production", request_id: requestId }
      : { git_sha: commit.sha, force_deploy: "true", request_id: requestId };
    const plan = { repository: this.config.repository, workflow, workflowRef, sha: commit.sha, environment: target, requestId, inputs,
      workflowUrl: `https://github.com/${this.config.repository}/actions/workflows/${workflow}` };
    if (o.dryRun) return { ...plan, dispatched: false, note: "Dry run: gates checked; no write request sent. Workflow will resolve/build artifacts and deploy the backend." };
    if (!o.yes) throw new OpsError("CONFIRMATION_REQUIRED", `Ready to ${rollback ? "roll back" : "deploy"} ${commit.sha} to ${target}.`, "Review --dry-run, then repeat with --yes to dispatch the workflow.", 2, plan);
    if (o.signal?.aborted) throw new OpsError("INTERRUPTED", "Dispatch cancelled locally before sending.", "No workflow dispatch was sent.", 130);
    try { await this.gh.post(`${this.root}/actions/workflows/${workflow}/dispatches`, { ref: workflowRef, inputs }); }
    catch (cause) {
      if (cause instanceof OpsError) { cause.details = { ...cause.details, requestId, workflowUrl: plan.workflowUrl }; throw cause; }
      throw cause;
    }
    return { ...plan, dispatched: true, note: "Request accepted. Use ops runs to follow it; this does not mean deployment succeeded." };
  }
  async requestRun(requestId: string): Promise<Run | undefined> {
    const matches = (await parallel(["staging", "production", "rollback"], kind => this.findDispatchedRun(`cd-${kind}.yml`, requestId))).filter((r): r is Run => Boolean(r));
    if (matches.length > 1) throw new OpsError("REQUEST_CONFLICT", "More than one workflow has this request ID.", "Select an explicit run ID from ops history.", 3);
    return matches[0];
  }
  async findDispatchedRun(workflow: string, requestId: string): Promise<Run | undefined> {
    const runs = await this.pages<Run>(this.gh, `${this.root}/actions/workflows/${workflow}/runs?event=workflow_dispatch`, "workflow_runs", 100);
    const matches = runs.filter(r => r.display_title?.includes(`[ops:${requestId}]`));
    if (matches.length > 1) throw new OpsError("REQUEST_CONFLICT", "Multiple runs have this request ID.", "Choose an explicit run ID from history.", 3);
    return matches[0];
  }
}
