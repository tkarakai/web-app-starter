import { mkdtemp, readFile, readdir, rename, rm, rmdir, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assignment } from './assignment.ts';
import { api, remoteSource, token } from './github.ts';
import { prepare, rotateLogs } from './images.ts';
import { launch, reconcile } from './runtime.ts';
import { assert, catalog, config, docker, exists, expiredEnvironments, hash, home, label, readJson, save, sourceRequest, type Config, type Job, type Run } from './core.ts';

export async function lock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const directory = path.join(home, `${name}.lock`);
  const staging = await mkdtemp(path.join(home, `${name}.owner-`));
  const owner = path.basename(staging);
  try {
    await writeFile(path.join(staging, owner), String(process.pid), { mode: 0o600 });
    for (;;) {
      try { await rename(staging, directory); break; }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as { code: string }).code)) throw error;
        const owners = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
        for (const file of owners) {
          const pid = Number(await readFile(path.join(directory, file), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return '0'; throw error; }));
          let alive = false;
          if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; } }
          assert(!alive, `Another worker operation holds ${name}; wait for it to finish`);
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
  if (!c.localOnly) {
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
    for (const folder of ['candidates', 'builds', 'downloads']) await rm(path.join(home, folder), { recursive: true, force: true });
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
  await lock('daemon', async () => {
    let c = await config();
    assert(!c.localOnly, 'Import a manager credential before starting the GitHub service');
    const active = new Map<number, Promise<void>>();
    const activeRuns = new Map<number, number>();
    let stop = false;
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { stop = true; });
    await lock('mutation', async () => { await reconcile(c); });
    let credential = await token();
    const repo = await api<{ id: number; private: boolean; default_branch: string }>(`/repos/${c.repo}`, credential);
    assert(repo.private || c.publicBranch, 'Public repositories require an explicit diagnostic branch; normal local routing is private-repository only');
    // Reconcile only registrations created by this installation, never somebody else's runners.
    const registrations = await api<{ runners: { id: number; name: string }[] }>(`/repos/${c.repo}/actions/runners?per_page=100`, credential);
    for (const runner of registrations.runners.filter(r => r.name.startsWith(`${c.pool}-`))) await api(`/repos/${c.repo}/actions/runners/${runner.id}`, credential, undefined, 'DELETE');
    let maintenance = 0;
    while (!stop) {
      try {
        c = await config(); credential = await token();
        for (const runId of new Set(activeRuns.values())) {
          const current = await api<{ status: string }>(`/repos/${c.repo}/actions/runs/${runId}`, credential);
          if (current.status === 'completed') {
            const names = (await docker(c, ['ps', '-a', '--filter', `label=${label}=${c.pool}`, '--filter', `label=${label}.run=${runId}`, '--format', '{{.Names}}'])).split('\n').filter(n => n.endsWith('-worker'));
            for (const name of names) await docker(c, ['stop', '--time', '10', name]);
          }
        }
        if (!c.paused && active.size < c.concurrency) {
          await capacity(c);
          const runs: Run[] = [];
          for (const status of ['queued', 'in_progress']) {
            for (let page = 1; page <= 5; page++) {
              const response = await api<{ workflow_runs: Run[] }>(`/repos/${c.repo}/actions/runs?status=${status}&per_page=100&page=${page}`, credential);
              runs.push(...response.workflow_runs);
              if (response.workflow_runs.length < 100) break;
            }
          }
          for (const run of runs) {
            c = await config();
            if (stop || c.paused || active.size >= c.concurrency) break;
            const jobs: Job[] = [];
            for (let page = 1; page <= 5; page++) {
              const response = await api<{ jobs: Job[] }>(`/repos/${c.repo}/actions/runs/${run.id}/jobs?per_page=100&page=${page}`, credential);
              jobs.push(...response.jobs);
              if (response.jobs.length < 100) break;
            }
            for (const job of jobs.filter(j => j.status === 'queued' && !active.has(j.id))) {
              c = await config();
              if (stop || c.paused || active.size >= c.concurrency) break;
              const request = sourceRequest(c, run, job, repo.id);
              if (!request) continue;
              if (c.updateRole && !c.publicBranch && run.head_branch !== repo.default_branch) continue;
              if (run.event === 'pull_request' && request.sha !== run.head_sha) {
                const commit = await api<{ parents: { sha: string }[] }>(`/repos/${c.repo}/git/commits/${request.sha}`, credential);
                const pr = run.pull_requests[0];
                if (commit.parents.length !== 2 || commit.parents[0].sha !== pr.base.sha || commit.parents[1].sha !== pr.head.sha) continue;
              }
              const environment = await lock('mutation', async () => {
                const git = await remoteSource(c, request.sha, credential);
                return prepare(c, git, request.sha, request.scope);
              });
              const current = await api<Job>(`/repos/${c.repo}/actions/jobs/${job.id}`, credential);
              c = await config();
              if (stop || c.paused || current.status !== 'queued') continue;
              const expected = assignment(c, run, request.sha, repo.id, request.job);
              const name = `${c.pool}-${job.id}-${Date.now()}`;
              const jit = await api<{ encoded_jit_config: string; runner: { id: number } }>(`/repos/${c.repo}/actions/runners/generate-jitconfig`, credential, {
                name, runner_group_id: 1, labels: ['self-hosted', 'Linux', c.pool, `starter-source-${request.sha}`, `starter-run-${run.id}`, ...(request.job ? [`starter-update-${request.job}`, `starter-attempt-${run.run_attempt}`] : [])], work_folder: '_work',
              });
              const runningConfig = c, runningToken = credential;
              const task = launch(c, c.updateRole === 'deliver' ? environment.tools : environment.image, ['github'], jit.encoded_jit_config + '\n', undefined, expected)
                .then(() => undefined).catch(error => { process.stderr.write(`Worker ${job.id}: ${String(error)}\n`); })
                .finally(async () => { await api(`/repos/${runningConfig.repo}/actions/runners/${jit.runner.id}`, runningToken, undefined, 'DELETE').catch(() => undefined); active.delete(job.id); activeRuns.delete(job.id); });
              active.set(job.id, task); activeRuns.set(job.id, run.id);
            }
          }
        }
        if (active.size === 0 && !c.paused && Date.now() - maintenance > 86400_000) {
          await lock('mutation', async () => { await cleanup(c, false);
            const state = await catalog();
            if (state.toolsCreated && Date.now() - Date.parse(state.toolsCreated) > 86400_000) {
              const repository = await api<{ default_branch: string }>(`/repos/${c.repo}`, credential);
              const branch = c.publicBranch ?? repository.default_branch;
              const commit = await api<{ sha: string }>(`/repos/${c.repo}/commits/${encodeURIComponent(branch)}`, credential);
              const git = await remoteSource(c, commit.sha, credential);
              await prepare(c, git, commit.sha, `branch-${hash(branch).slice(0, 16)}`, true);
            }
          });
          maintenance = Date.now();
        }
        c = await config();
        await save(path.join(home, 'status.json'), { pauseRequest: c.pauseRequest, pid: process.pid, polled: new Date().toISOString(), active: [...active.keys()], paused: c.paused });
      } catch (error) {
        process.stderr.write(`${new Date().toISOString()} ${String(error)}\n`);
        await save(path.join(home, 'status.json'), { pid: process.pid, error: String(error), active: [...active.keys()], polled: new Date().toISOString() });
      }
      for (let n = 0; n < 15 && !stop; n++) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await Promise.allSettled(active.values());
  });
}
export async function status(): Promise<unknown> {
  const c = await config();
  const heartbeat = await readJson<Record<string, unknown>>(path.join(home, 'status.json'), {});
  const engine = await docker(c, ['info', '--format', '{{.OSType}}/{{.Architecture}}']).catch(() => 'unavailable');
  return { ...c, engine, ...heartbeat, credentialWarning: c.tokenExpiry && Date.parse(c.tokenExpiry) - Date.now() < 14 * 86400_000 ? `Replace credential before ${c.tokenExpiry}` : undefined, environments: (await catalog()).environments.length };
}
