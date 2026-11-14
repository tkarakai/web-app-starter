import { mkdtemp, readFile, readdir, rename, rm, rmdir, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assignment } from './assignment.ts';
import { api, assertOrgAccess, GitHubError, listPages, privateRepository, remoteSource, token } from './github.ts';
import { prepare, rotateLogs, rotateManagerLog } from './images.ts';
import { launch, reconcile } from './runtime.ts';
import { assert, assertPrivateMode, catalog, command, config, configuredRepos, docker, exists, expiredEnvironments, hash, home, label, preparedScope, readJson, save, sourceRequest, type Config, type Job, type Run } from './core.ts';

export function runnerName(pool: string, jobId: number, now = Date.now()): string {
  // Keep the cleanup prefix intact; two base-36 safe integers fit the 64-character limit.
  return `${pool}-${jobId.toString(36)}-${now.toString(36)}`;
}

export const pollInterval = 15_000;
const maintenanceInterval = 86400_000;
/** Exponential backoff: `base` after the first failure, doubling up to `max`. */
export function failureDelay(failures: number, base: number, max: number): number {
  return failures <= 0 ? base : Math.min(max, base * 2 ** Math.min(failures - 1, 30));
}
/** Wait before retrying after an error, honouring GitHub rate-limit reset times up to `max`. */
export function retryDelay(error: unknown, backoff: number, max: number, now = Date.now()): number {
  const retryAt = error instanceof GitHubError ? error.retryAt : undefined;
  return retryAt === undefined ? backoff : Math.min(max, Math.max(backoff, retryAt - now + 1000));
}
export interface MaintenanceState { next: number; failures: number; at?: string; error?: string; }
export const maintenanceFile = (): string => path.join(home, 'maintenance.json');
/**
 * Run daily maintenance when due. A success schedules the next run a day later; a failure backs off
 * from 15 minutes to 6 hours instead of retrying on every poll. The schedule survives restarts.
 */
export async function maintain(action: () => Promise<void>, now = Date.now): Promise<MaintenanceState> {
  const state = await readJson<MaintenanceState>(maintenanceFile(), { next: 0, failures: 0 }).catch(() => ({ next: 0, failures: 0 }));
  if (now() < state.next) return state;
  let next: MaintenanceState;
  try {
    await action();
    next = { next: now() + maintenanceInterval, failures: 0, at: new Date(now()).toISOString() };
  } catch (error) {
    const failures = state.failures + 1;
    const delay = retryDelay(error, failureDelay(failures, 15 * 60_000, 6 * 3600_000), maintenanceInterval, now());
    next = { next: now() + delay, failures, at: new Date(now()).toISOString(), error: String(error) };
    process.stderr.write(`${next.at} Maintenance failed (attempt ${failures}); next attempt after ${new Date(next.next).toISOString()}: ${String(error)}\n`);
  }
  await save(maintenanceFile(), next);
  return next;
}
/** Treat rate limits and rejected credentials as shared failures that pause the whole manager. */
export function sharedFailure(error: unknown): boolean {
  return error instanceof GitHubError && (error.retryAt !== undefined || error.status === 401);
}
/** Per-job and per-repository backoff: one failing item neither blocks the others nor repeats every poll. */
export class Deferrals {
  readonly #entries = new Map<string, { failures: number; next: number }>();
  ready(key: string, now = Date.now()): boolean { return (this.#entries.get(key)?.next ?? 0) <= now; }
  succeeded(key: string): void { this.#entries.delete(key); }
  failed(key: string, error: unknown, now = Date.now()): void {
    if (sharedFailure(error)) throw error;
    for (const [entry, value] of this.#entries) if (value.next < now - 86400_000) this.#entries.delete(entry);
    const failures = (this.#entries.get(key)?.failures ?? 0) + 1;
    const next = now + failureDelay(failures, 60_000, 30 * 60_000);
    this.#entries.set(key, { failures, next });
    process.stderr.write(`${new Date(now).toISOString()} ${key}: ${String(error)} (failure ${failures}; retry after ${new Date(next).toISOString()})\n`);
  }
}
/** A full disk must not prevent the cleanup that frees it: reclaim once when idle, then recheck. */
async function admissionCapacity(c: Config, idle: boolean): Promise<void> {
  try { await capacity(c); }
  catch (error) {
    if (!idle) throw error;
    await lock('mutation', () => cleanup(c, false).then(() => undefined));
    await capacity(c);
  }
}
async function pause(milliseconds: number, stopped: () => boolean): Promise<void> {
  const until = Date.now() + milliseconds;
  while (!stopped() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(1000, until - Date.now())));
}

/**
 * JIT registrations owned by this installation. Failed deletions are retried on later polls, and a sweep removes
 * owned registrations no running worker uses (for example after a lost generate-jitconfig response).
 */
export class Registrations {
  readonly active = new Set<number>();
  readonly #base: string;
  readonly #pool: string;
  readonly #pending = new Set<number>();
  constructor(base: string, pool: string) { this.#base = base; this.#pool = pool; }
  get pending(): number[] { return [...this.#pending]; }
  async remove(id: number, credential: string): Promise<void> {
    try { await api(`${this.#base}/actions/runners/${id}`, credential, undefined, 'DELETE'); }
    catch (error) {
      if (!(error instanceof GitHubError && error.status === 404)) {
        if (!this.#pending.has(id)) process.stderr.write(`${new Date().toISOString()} Runner registration ${id} removal failed; retrying on later polls: ${String(error)}\n`);
        this.#pending.add(id);
        return;
      }
    }
    this.#pending.delete(id);
  }
  async retry(credential: string): Promise<void> { for (const id of this.pending) await this.remove(id, credential); }
  /** Remove this installation's idle registrations; never another installation's or anybody else's runners. */
  async sweep(credential: string): Promise<void> {
    const { items, complete } = await listPages<{ id: number; name: string }>(`${this.#base}/actions/runners`, 'runners', credential, 10);
    assert(complete, 'Runner listing exceeds 1000; cannot complete owned-registration reconciliation');
    for (const runner of items) if (runner.name.startsWith(`${this.#pool}-`) && !this.active.has(runner.id)) await this.remove(runner.id, credential);
  }
}
/** Report a truncated listing once when it starts, not on every poll. */
export function noticeTruncation(notices: Set<string>, key: string, complete: boolean, message: string): void {
  if (complete) { notices.delete(key); return; }
  if (notices.has(key)) return;
  notices.add(key);
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}
/** Queued and in-progress runs, oldest first so a backlog drains in order (GitHub lists newest first). */
export async function schedulableRuns(repo: string, credential: string, notices: Set<string>): Promise<Run[]> {
  const runs = new Map<number, Run>();
  let complete = true;
  for (const status of ['queued', 'in_progress']) {
    const listed = await listPages<Run>(`/repos/${repo}/actions/runs?status=${status}`, 'workflow_runs', credential, 5);
    complete &&= listed.complete;
    for (const run of listed.items) runs.set(run.id, run);
  }
  noticeTruncation(notices, `runs ${repo}`, complete, `${repo} has more than 500 queued or in-progress runs; newer runs wait until the backlog shrinks`);
  return [...runs.values()].sort((a, b) => a.id - b.id);
}
export async function runJobs(repo: string, runId: number, credential: string, notices: Set<string>): Promise<Job[]> {
  const listed = await listPages<Job>(`/repos/${repo}/actions/runs/${runId}/jobs`, 'jobs', credential, 10);
  noticeTruncation(notices, `jobs ${repo} ${runId}`, listed.complete, `${repo} run ${runId} has more than 1000 jobs; only the first 1000 are scheduled`);
  return listed.items;
}
/** Create a JIT registration; when the outcome is unknown, sweep so a lost response cannot leave one behind. */
export async function register(registrations: Registrations, credential: string, endpoint: string, body: unknown): Promise<{ encoded_jit_config: string; runner: { id: number } }> {
  try {
    const jit = await api<{ encoded_jit_config: string; runner: { id: number } }>(endpoint, credential, body);
    registrations.active.add(jit.runner.id);
    return jit;
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status >= 500) await registrations.sweep(credential).catch(() => undefined);
    throw error;
  }
}
function rotateLog(): void {
  try { rotateManagerLog(); } catch (error) { process.stderr.write(`${new Date().toISOString()} Log rotation failed: ${String(error)}\n`); }
}

let bootIdentity: Promise<string> | undefined;
/** Identifies the current boot, so a lock left before a reboot is stale even when its PID has been reused. */
export function bootId(): Promise<string> {
  bootIdentity ??= (async () => {
    try {
      const value = process.platform === 'linux' ? await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
        : /\bsec = (\d+)/.exec(await command('/usr/sbin/sysctl', ['-n', 'kern.boottime']))?.[1];
      return value?.trim() ? hash(value.trim()).slice(0, 16) : '';
    } catch { return ''; }
  })();
  return bootIdentity;
}
// Owner files hold the PID; the boot tag lives in the file name so older managers still read the PID.
async function ownerAlive(directory: string, file: string, boot: string): Promise<boolean> {
  const recorded = /\.boot-([a-f0-9]{16})$/.exec(file)?.[1];
  if (recorded && boot && recorded !== boot) return false;
  const pid = Number(await readFile(path.join(directory, file), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return '0'; throw error; }));
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
/** Whether a live process from this boot holds the named lock; an abandoned lock directory is not held. */
export async function lockHeld(name: string, root = home): Promise<boolean> {
  const directory = path.join(root, `${name}.lock`);
  let owners: string[];
  try { owners = await readdir(directory); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    if (code === 'ENOTDIR') return true; // Something else occupies the lock path; lock() cannot take it either.
    throw error;
  }
  const boot = await bootId();
  for (const file of owners) if (await ownerAlive(directory, file, boot)) return true;
  return false;
}
export async function lock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const directory = path.join(home, `${name}.lock`);
  const staging = await mkdtemp(path.join(home, `${name}.owner-`));
  const boot = await bootId();
  const owner = path.basename(staging) + (boot ? `.boot-${boot}` : '');
  try {
    await writeFile(path.join(staging, owner), String(process.pid), { mode: 0o600 });
    for (;;) {
      try { await rename(staging, directory); break; }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as { code: string }).code)) throw error;
        const owners = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
        for (const file of owners) {
          assert(!await ownerAlive(directory, file, boot), `Another worker operation holds ${name}; wait for it to finish`);
          await rm(path.join(directory, file), { force: true });
        }
        await rmdir(directory).catch((error: NodeJS.ErrnoException) => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code!)) throw error; });
      }
    }
    try { return await action(); } finally { await rm(path.join(directory, owner), { force: true }); await rmdir(directory).catch((error: NodeJS.ErrnoException) => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code!)) throw error; }); }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function updateConfig(action: (current: Readonly<Config>) => Promise<Partial<Config>>): Promise<Config> {
  return lock('configuration', async () => {
    const current = await config();
    const patch = await action(current);
    const updated = { ...current, ...patch };
    await save(path.join(home, 'config.json'), updated);
    return updated;
  });
}
export async function cleanup(c: Config, dryRun: boolean): Promise<string[]> {
  const state = await catalog();
  const containers = (await docker(c, ['ps', '-aq', '--filter', `label=${label}=${c.pool}`])).split(/\s+/).filter(Boolean);
  const leased = new Set<string>();
  for (const id of containers) leased.add(await docker(c, ['inspect', '-f', '{{.Image}}', id]));
  const protectedImages = new Set([...leased, ...state.environments.filter(e => Date.now() - Date.parse(e.used) < 86400_000).map(e => e.image)]);
  const deletions = expiredEnvironments(state.environments, protectedImages);
  if (!c.localOnly && !c.org) {
    for (const scope of new Set(state.environments.map(e => e.scope).filter(s => /^pr-\d+$/.test(s)))) {
      const pr = await api<{ state: string; closed_at: string | null }>(`/repos/${c.repo}/pulls/${scope.slice(3)}`, await token());
      if (pr.state === 'closed' && pr.closed_at && Date.now() - Date.parse(pr.closed_at) > 48 * 3600_000) {
        for (const e of state.environments.filter(e => e.scope === scope && !protectedImages.has(e.image))) if (!deletions.includes(e)) deletions.push(e);
      }
    }
  }
  const remaining = state.environments.filter(e => !deletions.includes(e));
  const protectedTools = new Set([state.tools, ...remaining.map(e => e.tools), ...leased]);
  for (const [family, tools] of Object.entries(state.toolchains ?? {})) {
    if (!protectedTools.has(tools.image) && Date.now() - Date.parse(tools.created) > 7 * 86400_000) delete state.toolchains![family];
    else protectedTools.add(tools.image);
  }
  const tags = new Set(deletions.map(env => `${c.pool}:seed-${env.key.slice(0, 24)}`));
  const owned = (await docker(c, ['image', 'ls', '--filter', `label=${label}=${c.pool}`, '--format', '{{.Repository}}:{{.Tag}}'])).split('\n').filter(t => t.startsWith(`${c.pool}:tools-`) || t.startsWith(`${c.pool}:seed-`));
  const orphaned: string[] = [];
  for (const tag of owned) {
    if (tags.has(tag)) continue;
    const [image] = JSON.parse(await docker(c, ['image', 'inspect', tag])) as { Id: string; Created: string }[];
    const seed = tag.startsWith(`${c.pool}:seed-`);
    const protectedImage = seed ? remaining.some(e => e.image === image.Id) || leased.has(image.Id) : protectedTools.has(image.Id);
    const candidate = tag.startsWith(`${c.pool}:tools-candidate-`) || tag.startsWith(`${c.pool}:seed-candidate-`);
    if ((candidate && !leased.has(image.Id)) || (!protectedImage && (seed || Date.now() - Date.parse(image.Created) > 7 * 86400_000))) { tags.add(tag); orphaned.push(image.Id); }
  }
  if (!dryRun) {
    for (const tag of tags) {
      const present = (await docker(c, ['image', 'ls', '--filter', `reference=${tag}`, '--format', '{{.Repository}}:{{.Tag}}'])).split('\n').includes(tag);
      if (present) await docker(c, ['image', 'rm', tag]);
    }
    state.environments = remaining;
    await save(path.join(home, 'catalog.json'), state);
    await docker(c, ['buildx', 'prune', '--builder', `${c.pool}-build`, '--force', '--filter', 'until=168h', '--max-used-space', `${Math.max(2, Math.floor(c.diskGiB / 3))}gb`]);
    const layouts = path.join(home, 'tool-layouts');
    if (await exists(layouts)) for (const file of await readdir(layouts)) if (/^[a-f0-9]{64}$/.test(file) && !protectedTools.has(`sha256:${file}`)) await rm(path.join(layouts, file), { recursive: true, force: true });
    // The source mirror only caches shallow fetches of job revisions; the next job fetches its revision again.
    for (const folder of ['candidates', 'builds', 'downloads', 'source.git']) await rm(path.join(home, folder), { recursive: true, force: true });
    await rotateLogs();
  }
  return [...deletions.map(e => e.image), ...orphaned];
}
async function capacity(c: Config): Promise<void> {
  const fs = await statfs(home);
  assert(fs.bavail * fs.bsize > 3 * 1024 ** 3, 'Less than 3 GiB free: cleanup or free disk before accepting jobs');
  // Unique image sizes are deliberately conservative: shared layers can make this overestimate.
  const images = new Map((await catalog()).environments.map(e => [e.image, e.bytes]));
  assert([...images.values()].reduce((a, b) => a + b, 0) < c.diskGiB * 1024 ** 3, 'Prepared image budget reached; cleanup or increase diskGiB');
}
export async function serve(): Promise<void> {
  if ((await config()).org) return serveOrg();
  await lock('daemon', async () => {
    let c = await config();
    assertPrivateMode(c);
    assert(!c.localOnly, 'Import a manager credential before starting the GitHub service');
    const active = new Map<number, Promise<void>>();
    const runIds = new Map<number, number>();
    let stop = false;
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { stop = true; });
    let credential = await token();
    await privateRepository(c, credential);
    let repo: Awaited<ReturnType<typeof privateRepository>>;
    await lock('mutation', async () => { await reconcile(c); });
    // Reconcile only registrations created by this installation, never somebody else's runners.
    const registrations = new Registrations(`/repos/${c.repo}`, c.pool);
    await registrations.sweep(credential);
    let failures = 0;
    const deferrals = new Deferrals();
    const notices = new Set<string>();
    while (!stop) {
      let wait = pollInterval;
      try {
        c = await config(); credential = await token();
        repo = await privateRepository(c, credential);
        await registrations.retry(credential);
        for (const runId of new Set(runIds.values())) {
          const current = await api<{ status: string }>(`/repos/${c.repo}/actions/runs/${runId}`, credential);
          if (current.status === 'completed') {
            const names = (await docker(c, ['ps', '-a', '--filter', `label=${label}=${c.pool}`, '--filter', `label=${label}.run=${runId}`, '--format', '{{.Names}}'])).split('\n').filter(n => n.endsWith('-worker'));
            for (const name of names) await docker(c, ['stop', '--time', '10', name]);
          }
        }
        if (!c.paused && active.size < c.concurrency) {
          await admissionCapacity(c, active.size === 0);
          for (const run of await schedulableRuns(c.repo, credential, notices)) {
            c = await config();
            if (stop || c.paused || active.size >= c.concurrency) break;
            const jobs = await runJobs(c.repo, run.id, credential, notices);
            for (const job of jobs.filter(j => j.status === 'queued' && !active.has(j.id) && deferrals.ready(`job ${j.id}`))) {
              c = await config();
              if (stop || c.paused || active.size >= c.concurrency) break;
              try {
                const request = sourceRequest(c, run, job, repo.id);
                if (!request) continue;
                if (c.updateRole && run.head_branch !== repo.default_branch) continue;
                if (run.event === 'pull_request' && request.sha !== run.head_sha) {
                  const commit = await api<{ parents: { sha: string }[] }>(`/repos/${c.repo}/git/commits/${request.sha}`, credential);
                  const pr = run.pull_requests[0];
                  if (commit.parents.length !== 2 || commit.parents[0].sha !== pr.base.sha || commit.parents[1].sha !== pr.head.sha) continue;
                }
                const environment = await lock('mutation', async () => {
                  const git = await remoteSource(c, request.sha, credential);
                  return prepare(c, git, request.sha, request.scope, false, credential);
                });
                const current = await api<Job>(`/repos/${c.repo}/actions/jobs/${job.id}`, credential);
                c = await config();
                if (stop || c.paused || current.status !== 'queued') continue;
                const admitted = await privateRepository(c, credential);
                assert(admitted.id === repo.id, 'Repository identity changed before registration');
                const expected = assignment(c, run, request.sha, repo.id, request.job);
                const name = runnerName(c.pool, job.id);
                const jit = await register(registrations, credential, `/repos/${c.repo}/actions/runners/generate-jitconfig`, {
                  name, runner_group_id: 1, labels: ['self-hosted', 'Linux', c.pool, `starter-source-${request.sha}`, `starter-run-${run.id}`, ...(request.job ? [`starter-update-${request.job}`, `starter-attempt-${run.run_attempt}`] : [])], work_folder: '_work',
                });
                const runningToken = credential;
                const task = launch(c, c.updateRole === 'deliver' ? environment.tools : environment.image, ['github'], jit.encoded_jit_config + '\n', undefined, expected)
                  .then(() => undefined).catch(error => { process.stderr.write(`Worker ${job.id}: ${String(error)}\n`); })
                  .finally(async () => { await registrations.remove(jit.runner.id, runningToken); registrations.active.delete(jit.runner.id); active.delete(job.id); runIds.delete(job.id); });
                active.set(job.id, task); runIds.set(job.id, run.id);
                deferrals.succeeded(`job ${job.id}`);
              } catch (error) { deferrals.failed(`job ${job.id}`, error); }
            }
          }
        }
        if (active.size === 0 && !c.paused) {
          await maintain(() => lock('mutation', async () => { await cleanup(c, false);
            await registrations.sweep(credential);
            const state = await catalog();
            if (state.toolsCreated && Date.now() - Date.parse(state.toolsCreated) > maintenanceInterval) {
              const repository = await privateRepository(c, credential);
              const branch = repository.default_branch;
              const commit = await api<{ sha: string }>(`/repos/${c.repo}/commits/${encodeURIComponent(branch)}`, credential);
              const git = await remoteSource(c, commit.sha, credential);
              await prepare(c, git, commit.sha, `branch-${hash(branch).slice(0, 16)}`, true, credential);
            }
          }));
        }
        c = await config();
        failures = 0;
        await save(path.join(home, 'status.json'), { pauseRequest: c.pauseRequest, pid: process.pid, polled: new Date().toISOString(), active: [...active.keys()], paused: c.paused, ...(registrations.pending.length ? { pendingRunnerRemovals: registrations.pending } : {}) });
      } catch (error) {
        failures++;
        wait = retryDelay(error, failureDelay(failures, pollInterval, 10 * 60_000), 3600_000);
        const retry = new Date(Date.now() + wait).toISOString();
        process.stderr.write(`${new Date().toISOString()} ${String(error)} (failure ${failures}; next poll after ${retry})\n`);
        await save(path.join(home, 'status.json'), { pid: process.pid, error: String(error), failures, retry, active: [...active.keys()], polled: new Date().toISOString() });
      }
      rotateLog();
      await pause(wait, () => stop);
    }
    await Promise.allSettled(active.values());
  });
}

async function serveOrg(): Promise<void> {
  await lock('daemon', async () => {
    let c = await config();
    assertPrivateMode(c);
    assert(c.org && c.runnerGroupId && configuredRepos(c).length && !c.localOnly && !c.updateRole, 'Invalid organization worker configuration');
    const org = c.org;
    const active = new Map<number, { repo: string; runId: number; task: Promise<void> }>();
    let cursor = 0;
    let stop = false;
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { stop = true; });
    let credential = await token();
    for (const repo of configuredRepos(c)) await assertOrgAccess(c, credential, repo);
    await lock('mutation', () => reconcile(c));
    const registrations = new Registrations(`/orgs/${org}`, c.pool);
    await registrations.sweep(credential);
    let failures = 0;
    const deferrals = new Deferrals();
    const notices = new Set<string>();
    // Listing a member's runs reuses a recent access check; preparation and registration always recheck.
    const access = new Map<string, { id: number; until: number }>();
    const memberAccess = async (repoName: string): Promise<number> => {
      const cached = access.get(repoName.toLowerCase());
      if (cached && cached.until > Date.now()) return cached.id;
      access.delete(repoName.toLowerCase());
      const id = await assertOrgAccess(c, credential, repoName);
      access.set(repoName.toLowerCase(), { id, until: Date.now() + 5 * 60_000 });
      return id;
    };
    while (!stop) {
      let wait = pollInterval;
      try {
        c = await config(); credential = await token();
        assert(c.org === org && c.runnerGroupId, 'Organization configuration changed while running');
        await registrations.retry(credential);
        for (const running of active.values()) {
          const run = await api<{ status: string }>(`/repos/${running.repo}/actions/runs/${running.runId}`, credential);
          if (run.status !== 'completed') continue;
          const names = (await docker(c, ['ps', '-a', '--filter', `label=${label}=${c.pool}`, '--filter', `label=${label}.run=${running.runId}`, '--format', '{{.Names}}'])).split('\n').filter(n => n.endsWith('-worker'));
          for (const name of names) await docker(c, ['stop', '--time', '10', name]);
        }
        if (!c.paused && active.size < c.concurrency) {
          await admissionCapacity(c, active.size === 0);
          const names = configuredRepos(c);
          for (let offset = 0; offset < names.length; offset++) {
            const repoName = names[(cursor + offset) % names.length];
            if (stop || active.size >= c.concurrency) break;
            if (!deferrals.ready(`repository ${repoName}`)) continue;
            try {
              const repoId = await memberAccess(repoName);
              for (const run of await schedulableRuns(repoName, credential, notices)) {
                if (stop || active.size >= c.concurrency) break;
                const jobs = await runJobs(repoName, run.id, credential, notices);
                for (const job of jobs.filter(j => j.status === 'queued' && !active.has(j.id) && deferrals.ready(`job ${j.id}`))) {
                  c = await config();
                  if (stop || c.paused || active.size >= c.concurrency || !configuredRepos(c).includes(repoName)) break;
                  try {
                    const selected = { ...c, repo: repoName };
                    const request = sourceRequest(selected, run, job, repoId);
                    if (!request) continue;
                    if (run.event === 'pull_request' && request.sha !== run.head_sha) {
                      const commit = await api<{ parents: { sha: string }[] }>(`/repos/${repoName}/git/commits/${request.sha}`, credential);
                      const pr = run.pull_requests[0];
                      if (commit.parents.length !== 2 || commit.parents[0].sha !== pr.base.sha || commit.parents[1].sha !== pr.head.sha) continue;
                    }
                    assert(await assertOrgAccess(c, credential, repoName) === repoId, 'Repository identity changed before preparation');
                    const environment = await lock('mutation', async () => {
                      const git = await remoteSource(selected, request.sha, credential);
                      return prepare(selected, git, request.sha, preparedScope(selected, request.scope), false, credential);
                    });
                    const current = await api<Job>(`/repos/${repoName}/actions/jobs/${job.id}`, credential);
                    c = await config();
                    if (stop || c.paused || current.status !== 'queued' || !configuredRepos(c).includes(repoName)) continue;
                    assert(await assertOrgAccess(c, credential, repoName) === repoId, 'Repository identity changed before registration');
                    const expected = assignment(selected, run, request.sha, repoId);
                    const jit = await register(registrations, credential, `/orgs/${org}/actions/runners/generate-jitconfig`, {
                      name: runnerName(c.pool, job.id), runner_group_id: c.runnerGroupId,
                      labels: ['self-hosted', 'Linux', c.pool, `starter-source-${request.sha}`, `starter-run-${run.id}`], work_folder: '_work',
                    });
                    const runningToken = credential;
                    const task = launch(selected, environment.image, ['github'], jit.encoded_jit_config + '\n', undefined, expected)
                      .then(() => undefined).catch(error => { process.stderr.write(`Worker ${job.id}: ${String(error)}\n`); })
                      .finally(async () => {
                        await registrations.remove(jit.runner.id, runningToken);
                        registrations.active.delete(jit.runner.id);
                        active.delete(job.id);
                      });
                    active.set(job.id, { repo: repoName, runId: run.id, task });
                    deferrals.succeeded(`job ${job.id}`);
                  } catch (error) { deferrals.failed(`job ${job.id}`, error); }
                }
              }
              deferrals.succeeded(`repository ${repoName}`);
            } catch (error) { access.delete(repoName.toLowerCase()); deferrals.failed(`repository ${repoName}`, error); }
          }
          cursor = names.length ? (cursor + 1) % names.length : 0;
        }
        if (active.size === 0 && !c.paused) {
          await maintain(() => lock('mutation', async () => {
            await cleanup(c, false);
            await registrations.sweep(credential);
            const state = await catalog();
            if (state.toolsCreated && Date.now() - Date.parse(state.toolsCreated) > maintenanceInterval) {
              const repoName = configuredRepos(c)[0];
              const selected = { ...c, repo: repoName };
              await assertOrgAccess(c, credential, repoName);
              const repository = await api<{ default_branch: string }>(`/repos/${repoName}`, credential);
              const commit = await api<{ sha: string }>(`/repos/${repoName}/commits/${encodeURIComponent(repository.default_branch)}`, credential);
              const git = await remoteSource(selected, commit.sha, credential);
              await prepare(selected, git, commit.sha, preparedScope(selected, `branch-${hash(repository.default_branch).slice(0, 16)}`), true, credential);
            }
          }));
        }
        c = await config();
        failures = 0;
        await save(path.join(home, 'status.json'), { pauseRequest: c.pauseRequest, pid: process.pid, polled: new Date().toISOString(), active: [...active.keys()], paused: c.paused, ...(registrations.pending.length ? { pendingRunnerRemovals: registrations.pending } : {}) });
      } catch (error) {
        failures++;
        wait = retryDelay(error, failureDelay(failures, pollInterval, 10 * 60_000), 3600_000);
        const retry = new Date(Date.now() + wait).toISOString();
        process.stderr.write(`${new Date().toISOString()} ${String(error)} (failure ${failures}; next poll after ${retry})\n`);
        await save(path.join(home, 'status.json'), { pid: process.pid, error: String(error), failures, retry, active: [...active.keys()], polled: new Date().toISOString() });
      }
      rotateLog();
      await pause(wait, () => stop);
    }
    await Promise.allSettled([...active.values()].map(value => value.task));
  });
}
export async function status(): Promise<unknown> {
  const c = await config();
  const heartbeat = await readJson<Record<string, unknown>>(path.join(home, 'status.json'), {});
  const engine = await docker(c, ['info', '--format', '{{.OSType}}/{{.Architecture}}']).catch(() => 'unavailable');
  const maintenance = await readJson<MaintenanceState | undefined>(maintenanceFile(), undefined).catch(() => undefined);
  return { ...c, engine, ...heartbeat, maintenance, credentialWarning: c.tokenExpiry && Date.parse(c.tokenExpiry) - Date.now() < 14 * 86400_000 ? `Replace credential before ${c.tokenExpiry}` : undefined, environments: (await catalog()).environments.length };
}
