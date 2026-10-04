import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { demand } from '../platform-upgrade/metadata.ts';
import { hash, updaterCheckWorkflow, type Config } from '../ci-workers/core.ts';
import { proofId, type Proof } from '../ci-workers/proof.ts';
import { installationComplete } from '../ci-workers/service.ts';
import type { Gh } from './github.ts';
import { WORKER_VARIABLES, workerCommand, workerVariables, type WorkerChoice, type WorkerRecord } from './worker-state.ts';

export type Pools = { verify: string; deliver: string };
export type WorkerProof = Proof & { repository: string; role: 'verify' | 'deliver'; workflow: string; localOnly: boolean; publicBranch?: string; managerHealthy: boolean };
export type Proofs = { verify: WorkerProof; deliver: WorkerProof };
export type WorkerOptions = { choice: WorkerChoice; root: string; repo: string; runId?: string; homes?: Pools };
export function workerHomes(repo: string): Pools {
  const base = path.join(os.homedir(), '.local/share/starter-updates', hash(repo.toLowerCase()).slice(0, 16));
  return { verify: path.join(base, 'verify'), deliver: path.join(base, 'deliver') };
}
export function validateProofs(proofs: Proofs, repo: string, sha: string): string {
  for (const role of ['verify', 'deliver'] as const) {
    const p = proofs[role], age = Date.now() - Date.parse(p.checked);
    demand(p.repository.toLowerCase() === repo.toLowerCase() && p.role === role && p.workflow === '.github/workflows/update-platform.yml', 'Worker installation belongs to another repository or role');
    demand(!p.localOnly && !p.publicBranch && p.managerHealthy, 'Both worker services must be authenticated, running and unpaused');
    demand(p.sha === sha && /^[a-f0-9]{40}$/.test(p.sha) && /^sha256:[a-f0-9]{64}$/.test(p.image) && /^[a-f0-9]{64}$/.test(p.runtime) && /^starter-[a-f0-9]{32}$/.test(p.pool), 'Worker proof does not match this committed app revision');
    demand(age >= 0 && age < 86400_000 && p.id === proofId(p), 'Worker proof expired or changed; repeat the local checks');
  }
  demand(proofs.verify.pool !== proofs.deliver.pool, 'Verification and delivery require separate installations');
  return hash(JSON.stringify([proofs.verify.id, proofs.deliver.id]));
}
export function certifyWorkers(repo: string, runId: string, sha: string, proof: string, pools: Pools, run: Gh): WorkerRecord['test'] {
  demand(/^[1-9][0-9]*$/.test(runId) && Number.isSafeInteger(Number(runId)), 'Invalid worker test run ID');
  const result = JSON.parse(run(['api', 'repos/' + repo + '/actions/runs/' + runId]));
  demand(result.event === 'workflow_dispatch' && result.path === updaterCheckWorkflow && result.head_sha === sha && result.display_title === 'Updater worker check ' + proof, 'GitHub test does not match these local proofs');
  demand(result.status === 'completed' && result.conclusion === 'success', 'GitHub worker test has not passed. Watch it with gh run watch ' + runId + ' --repo ' + repo + ' --exit-status, then resume setup with --worker-run ' + runId);
  const jobs = JSON.parse(run(['api', 'repos/' + repo + '/actions/runs/' + runId + '/attempts/' + result.run_attempt + '/jobs?per_page=100'])).jobs as { name: string; conclusion: string; labels: string[] }[];
  demand(jobs.length === 3 && ['check', 'verify', 'deliver'].every(name => jobs.some(j => j.name === name && j.conclusion === 'success' && ['self-hosted', pools[name === 'deliver' ? 'deliver' : 'verify'], 'starter-source-' + sha, 'starter-run-' + runId, 'starter-attempt-' + result.run_attempt, 'starter-update-' + name].every(label => j.labels.includes(label)))), 'All three test jobs must succeed in the selected pools and attempt; skipped jobs do not pass');
  return { runId: Number(runId), sha, proof, checkedAt: new Date().toISOString() };
}
/** Change the pair together as far as the GitHub API allows, restoring on a partial failure. */
export function setWorkerRouting(repo: string, before: Pools, after: Pools, run: Gh): void {
  const current = workerVariables(repo, run);
  demand(current.verify === before.verify && current.deliver === before.deliver, 'Worker routing changed during setup; inspect --check before retrying');
  const changed: ('verify' | 'deliver')[] = [];
  const write = (role: 'verify' | 'deliver', value: string) => run(value ? ['variable', 'set', WORKER_VARIABLES[role], '--repo', repo, '--body', value] : ['variable', 'delete', WORKER_VARIABLES[role], '--repo', repo]);
  try {
    for (const role of ['verify', 'deliver'] as const) if (before[role] !== after[role]) { changed.push(role); write(role, after[role]); }
    const observed = workerVariables(repo, run);
    demand(observed.verify === after.verify && observed.deliver === after.deliver, 'GitHub did not confirm both worker settings');
  } catch {
    let restored = true;
    for (const role of changed.reverse()) {
      try {
        const actual = workerVariables(repo, run)[role];
        if (actual === after[role]) write(role, before[role]);
        else if (actual !== before[role]) restored = false;
      } catch { restored = false; }
    }
    throw Error(restored ? 'Worker routing change failed; previous settings restored. Retry setup.' : 'Worker routing change failed and could not be fully restored. Inspect both PLATFORM_UPDATE_RUNNER and PLATFORM_UPDATE_DELIVERY_RUNNER in repository settings before retrying.');
  }
}
export type WorkerHost = {
  watch?(repo: string, runId: string): Promise<void>;
  sha(): string;
  prepare(role: 'verify' | 'deliver', home: string): Promise<void>;
  proof(role: 'verify' | 'deliver', home: string): WorkerProof;
};
export function workerHost(options: WorkerOptions, command?: (home: string, args: string[]) => Promise<void>): WorkerHost {
  const git = (...args: string[]) => execFileSync('git', ['-C', options.root, ...args], { encoding: 'utf8' }).trim();
  const invoke = command ?? ((home: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(options.root, 'platform/tooling/node-ts.sh'), [path.join(options.root, 'platform/tooling/ci-workers/cli.ts'), ...args], { cwd: options.root, env: { ...process.env, STARTER_WORKERS_HOME: home }, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('Worker command did not finish. Inspect the output above; routing is unchanged.')));
  }));
  return {
    async watch(repo, runId) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('gh', ['run', 'watch', runId, '--repo', repo, '--exit-status'], { stdio: 'inherit' });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('Worker test failed or monitoring was interrupted. Inspect its GitHub run; routing is unchanged.')));
      });
    },
    sha() {
      demand(['darwin', 'linux'].includes(process.platform), 'Local worker setup requires macOS or Linux with local Docker');
      const changed = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(line => line && line.slice(3) !== '.github/update-delivery.json');
      demand(changed.length === 0, 'Commit and push app setup files before testing local workers. Only the setup record may be uncommitted.');
      return git('rev-parse', 'HEAD');
    },
    async prepare(role, home) {
      const file = path.join(home, 'config.json');
      if (fs.existsSync(file)) {
        const c = JSON.parse(fs.readFileSync(file, 'utf8')) as Config;
        demand(c.repo.toLowerCase() === options.repo.toLowerCase() && c.updateRole === role && c.updateWorkflow === '.github/workflows/update-platform.yml' && !c.publicBranch, 'Selected installation is for another repository, role or diagnostic branch');
        demand(!c.paused, 'Selected worker installation is paused. Resume it explicitly before setup.');
        const stopped = !fs.existsSync(path.join(home, 'daemon.lock'));
        if (stopped && (c.localOnly || !await installationComplete(c.pool, home))) await invoke(home, ['setup']);
        demand(!c.localOnly || stopped, 'Stop the unauthenticated manager before resuming setup.');
      } else await invoke(home, ['setup', '--repo', options.repo, '--update-role', role, '--update-workflow', '.github/workflows/update-platform.yml']);
      await invoke(home, role === 'verify' ? ['check', '--install'] : ['check']);
      if (!fs.existsSync(path.join(home, 'daemon.lock'))) await invoke(home, ['service', 'start']);
      for (let n = 0; n < 15; n++) {
        const heartbeat = path.join(home, 'status.json');
        if (fs.existsSync(heartbeat)) {
          const status = JSON.parse(fs.readFileSync(heartbeat, 'utf8'));
          if (Date.now() - Date.parse(status.polled) < 30_000 && !status.error && !status.paused) break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    },
    proof(_role, home) {
      // Use the installed copy so an obsolete manager cannot silently certify new behavior.
      try { return JSON.parse(execFileSync(path.join(home, 'starter-workers'), ['proof'], { cwd: options.root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] })); }
      catch { throw Error('Cannot read a current worker proof. Use this installation’s absolute starter-workers path: pause --drain; service stop; update --from CHECKOUT; resume; check' + (_role === 'verify' ? ' --install' : '') + '; service start. Then repeat setup. See platform/docs/ci-workers.md.'); }
    },
  };
}
export async function configureWorkers(options: WorkerOptions, run: Gh, persist: (state: WorkerRecord) => void, local: WorkerHost = workerHost(options)): Promise<void> {
  persist({ choice: options.choice, status: 'pending', homes: options.homes, ownerActions: ['Resume ' + workerCommand(options.repo, options.choice, options.homes, options.runId) + '.'] });
  const before = workerVariables(options.repo, run), homes = options.homes ?? workerHomes(options.repo);
  if (options.choice === 'hosted') {
    setWorkerRouting(options.repo, before, { verify: '', deliver: '' }, run);
    persist({ choice: 'hosted', status: 'configured', ownerActions: [] });
    process.stdout.write('Updates now use GitHub-hosted workers. Existing jobs can finish. When drained, stop unused local services with each installation’s absolute starter-workers path: service stop.\n'); return;
  }
  const repo = JSON.parse(run(['api', 'repos/' + options.repo]));
  demand(repo.private === true && repo.permissions?.admin === true, 'Scheduled local update workers require a private repository and repository administration access');
  const sha = local.sha();
  const current = JSON.parse(run(['api', 'repos/' + options.repo + '/commits/' + encodeURIComponent(repo.default_branch)]));
  demand(current.sha === sha, 'Commit/push and check out the app default-branch tip before testing local update workers');
  // Check registration before asking for manager credentials or building Docker images.
  const workflow = JSON.parse(run(['api', 'repos/' + options.repo + '/actions/workflows/platform-update-workers-check.yml']));
  demand(workflow.state === 'active' && workflow.path === updaterCheckWorkflow, 'Commit the worker test workflow to the app default branch and enable it in Actions before local setup');
  process.stdout.write('Local workers need two separate installations and dedicated manager tokens. Each token selects only this repository: Administration write; Actions, Contents and Pull requests read. Keep Docker and both services running.\n');
  if (!options.runId) for (const role of ['verify', 'deliver'] as const) {
    process.stdout.write('Preparing ' + role + ' installation: ' + homes[role] + '\n');
    await local.prepare(role, homes[role]);
  }
  const proofs = { verify: local.proof('verify', homes.verify), deliver: local.proof('deliver', homes.deliver) };
  const proof = validateProofs(proofs, options.repo, sha), pools = { verify: proofs.verify.pool, deliver: proofs.deliver.pool };
  if (!options.runId) {
    run(['api', 'repos/' + options.repo + '/actions/workflows/platform-update-workers-check.yml/dispatches', '--method', 'POST', '--input', '-'], JSON.stringify({ ref: repo.default_branch, inputs: { proof, verify: JSON.stringify(proofs.verify), deliver: JSON.stringify(proofs.deliver) } }));
    let dispatched: string | undefined;
    for (let n = 0; n < 5 && !dispatched; n++) {
      const runs = JSON.parse(run(['api', 'repos/' + options.repo + '/actions/workflows/platform-update-workers-check.yml/runs?event=workflow_dispatch&per_page=100'])).workflow_runs as { id: number; display_title: string; head_sha: string }[];
      dispatched = runs.find(r => r.display_title === 'Updater worker check ' + proof && r.head_sha === sha)?.id.toString();
      if (!dispatched) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const action = 'In Actions, watch “Updater worker check ' + proof + '”. After it passes, run ' + workerCommand(options.repo, 'local', options.homes, dispatched ?? 'RUN_ID') + '. Routing is unchanged until that command confirms the test.';
    persist({ choice: 'local', status: 'pending', homes: options.homes, pools, ownerActions: [action] });
    process.stdout.write(action + '\n');
    if (!dispatched || !local.watch) return;
    await local.watch(options.repo, dispatched);
    options = { ...options, runId: dispatched };
  }
  const currentProofs = { verify: local.proof('verify', homes.verify), deliver: local.proof('deliver', homes.deliver) };
  demand(validateProofs(currentProofs, options.repo, sha) === proof, 'Local worker state changed during the GitHub test; repeat setup');
  const test = certifyWorkers(options.repo, options.runId!, sha, proof, pools, run);
  const latest = JSON.parse(run(['api', 'repos/' + options.repo + '/commits/' + encodeURIComponent(repo.default_branch)]));
  demand(latest.sha === sha, 'Default branch changed during the test; repeat local worker setup');
  setWorkerRouting(options.repo, before, pools, run);
  persist({ choice: 'local', status: 'configured', homes: options.homes, pools, test, ownerActions: [] });
  process.stdout.write('Both local installations passed the GitHub test. Scheduled update jobs now use these pools.\n');
}
