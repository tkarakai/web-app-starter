import test from 'node:test';
import assert from 'node:assert/strict';
import { configureWorkers, certifyWorkers, setWorkerRouting, validateProofs, type Proofs, type WorkerHost } from '../setup-updates/workers.ts';
import { workerStatus, WORKER_VARIABLES, type WorkerRecord } from '../setup-updates/worker-state.ts';
import { hash, updaterCheckWorkflow } from '../ci-workers/core.ts';
import { proofId } from '../ci-workers/proof.ts';
import { argumentsFor } from '../setup-updates.ts';
import type { Gh } from '../setup-updates/github.ts';

const sha = 'a'.repeat(40), repo = 'owner/app';
function proofs(): Proofs {
  const make = (role: 'verify' | 'deliver') => {
    const p = { sha, role, image: 'sha256:' + (role === 'verify' ? 'b' : 'c').repeat(64), runtime: 'd'.repeat(64), key: role, scope: 'update-' + role, pool: 'starter-' + (role === 'verify' ? '1' : '2').repeat(32), checked: new Date().toISOString(), repository: repo, workflow: '.github/workflows/update-platform.yml', localOnly: false, managerHealthy: true };
    return { ...p, id: proofId(p) };
  };
  return { verify: make('verify'), deliver: make('deliver') };
}
function fixture() {
  const p = proofs(), proof = hash(JSON.stringify([p.verify.id, p.deliver.id]));
  const variables = new Map<string, string>(), calls: { args: string[]; input?: string }[] = [];
  const result = { status: 'completed', conclusion: 'success', head_sha: sha, path: updaterCheckWorkflow, event: 'workflow_dispatch', display_title: 'Updater worker check ' + proof, run_attempt: 1 };
  const jobs = ['check', 'verify', 'deliver'].map(name => ({ name, conclusion: 'success', labels: ['self-hosted', p[name === 'deliver' ? 'deliver' : 'verify'].pool, 'starter-source-' + sha, 'starter-run-42', 'starter-attempt-1', 'starter-update-' + name] }));
  const run: Gh = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'variable') {
      if (args[1] === 'list') return JSON.stringify([...variables].map(([name, value]) => ({ name, value })));
      if (args[1] === 'set') variables.set(args[2], args.at(-1)!); else if (args[1] === 'delete') variables.delete(args[2]); else throw Error('Unexpected variable operation');
      return '';
    }
    assert.equal(args[0], 'api');
    if (args[1].endsWith('/dispatches')) return '';
    if (args[1].includes('/runs?event=')) return JSON.stringify({ workflow_runs: [{ id: 42, display_title: result.display_title, head_sha: sha }] });
    if (args[1].endsWith('/jobs?per_page=100')) return JSON.stringify({ jobs });
    if (args[1].endsWith('/runs/42')) return JSON.stringify(result);
    if (args[1].includes('/commits/')) return JSON.stringify({ sha });
    if (args[1].endsWith('/workflows/platform-update-workers-check.yml')) return JSON.stringify({ path: updaterCheckWorkflow, state: 'active' });
    if (args[1] === 'repos/' + repo) return JSON.stringify({ private: true, permissions: { admin: true }, default_branch: 'main' });
    throw Error('Unexpected operation ' + args.join(' '));
  };
  const prepared: string[] = [];
  const host: WorkerHost = { sha: () => sha, prepare: async role => { prepared.push(role); }, proof: role => p[role] };
  return { p, proof, variables, calls, result, jobs, run, host, prepared };
}
test('worker flags make changes explicit and reject ambiguous or read-only combinations', () => {
  assert.equal(argumentsFor([]).workers, undefined);
  assert.equal(argumentsFor(['--workers', 'hosted']).workers, 'hosted');
  for (const args of [['--check', '--workers', 'local'], ['--worker-run', '42'], ['--workers', 'local', '--verify-home', '/tmp/a'], ['--workers', 'any']]) assert.throws(() => argumentsFor(args));
});
test('local setup prepares separate installations and dispatches without changing routing; resume certifies before enabling', async () => {
  const f = fixture(), records: WorkerRecord[] = [];
  f.variables.set(WORKER_VARIABLES.verify, 'existing-verify'); f.variables.set(WORKER_VARIABLES.deliver, 'existing-deliver');
  const options = { choice: 'local' as const, root: '/app', repo };
  await configureWorkers(options, f.run, r => records.push(r), f.host);
  assert.deepEqual(f.prepared, ['verify', 'deliver']); assert.equal(records.at(-1)?.status, 'pending');
  assert.equal(f.variables.get(WORKER_VARIABLES.verify), 'existing-verify');
  const dispatch = f.calls.find(c => c.args[1].endsWith('/dispatches'))!;
  assert.equal(JSON.parse(dispatch.input!).inputs.proof, f.proof);
  f.prepared.length = 0;
  await configureWorkers({ ...options, runId: '42' }, f.run, r => records.push(r), f.host);
  assert.deepEqual(f.prepared, []); assert.equal(records.at(-1)?.status, 'configured'); assert.equal(records.at(-1)?.test?.runId, 42);
  assert.equal(f.variables.get(WORKER_VARIABLES.verify), f.p.verify.pool); assert.equal(f.variables.get(WORKER_VARIABLES.deliver), f.p.deliver.pool);
  assert.equal(workerStatus(repo, records.at(-1), f.run).readiness, 'ready');
});
test('failed, skipped, wrong-attempt, stale-source and unrelated test runs cannot enable workers', async () => {
  for (const alter of [
    (f: ReturnType<typeof fixture>) => { f.result.conclusion = 'failure'; },
    (f: ReturnType<typeof fixture>) => { f.jobs[1].conclusion = 'skipped'; },
    (f: ReturnType<typeof fixture>) => { f.result.run_attempt = 2; },
    (f: ReturnType<typeof fixture>) => { f.result.head_sha = 'f'.repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.result.path = '.github/workflows/other.yml'; },
    (f: ReturnType<typeof fixture>) => { f.result.display_title = 'another proof'; },
    (f: ReturnType<typeof fixture>) => { f.p.deliver.managerHealthy = false; },
  ]) {
    const f = fixture(); alter(f);
    await assert.rejects(configureWorkers({ choice: 'local', root: '/app', repo, runId: '42' }, f.run, () => {}, f.host));
    assert.equal(f.variables.size, 0); assert(!f.calls.some(c => c.args[0] === 'variable' && c.args[1] !== 'list'));
  }
});
test('proofs bind both roles, repo, source, freshness and pool separation', () => {
  for (const alter of [
    (p: Proofs) => { p.deliver.role = 'verify'; },
    (p: Proofs) => { p.deliver.repository = 'owner/other'; },
    (p: Proofs) => { p.verify.checked = '2000-01-01T00:00:00Z'; p.verify.id = proofId(p.verify); },
    (p: Proofs) => { p.verify.sha = 'f'.repeat(40); },
    (p: Proofs) => { p.deliver.pool = p.verify.pool; p.deliver.id = proofId(p.deliver); },
    (p: Proofs) => { p.verify.localOnly = true; },
    (p: Proofs) => { p.verify.publicBranch = 'diagnostic'; },
  ]) { const p = proofs(); alter(p); assert.throws(() => validateProofs(p, repo, sha)); }
});
test('hosted removes only the two updater settings and preserves ordinary CI settings', async () => {
  const f = fixture(), records: WorkerRecord[] = [];
  f.variables.set(WORKER_VARIABLES.verify, 'local-v'); f.variables.set(WORKER_VARIABLES.deliver, 'local-d'); f.variables.set('PLATFORM_CI_WORKER_POOL', 'ci-pool');
  await configureWorkers({ choice: 'hosted', root: '/app', repo }, f.run, r => records.push(r), f.host);
  assert.deepEqual([...f.variables], [['PLATFORM_CI_WORKER_POOL', 'ci-pool']]); assert.equal(records.at(-1)?.status, 'configured'); assert.deepEqual(f.prepared, []);
});
test('routing refuses concurrent edits and restores a partially changed pair', () => {
  const f = fixture(), before = { verify: '', deliver: '' }, after = { verify: 'new-v', deliver: 'new-d' };
  f.variables.set(WORKER_VARIABLES.verify, 'someone-else');
  assert.throws(() => setWorkerRouting(repo, before, after, f.run), /changed during/); assert.equal(f.variables.get(WORKER_VARIABLES.verify), 'someone-else');
  f.variables.clear();
  const fail: Gh = (args, input) => { if (args[1] === 'set' && args[2] === WORKER_VARIABLES.deliver) throw Error('Denied'); return f.run(args, input); };
  assert.throws(() => setWorkerRouting(repo, before, after, fail), /previous settings restored/); assert.equal(f.variables.size, 0);
});
test('read-only worker status distinguishes hosted, mixed, unknown and untested local routing', () => {
  const f = fixture(); assert.equal(workerStatus(repo, undefined, f.run).readiness, 'ready');
  f.variables.set(WORKER_VARIABLES.verify, 'manual-v'); assert.equal(workerStatus(repo, undefined, f.run).choice, 'mixed');
  f.variables.set(WORKER_VARIABLES.deliver, 'manual-d'); assert.equal(workerStatus(repo, undefined, f.run).readiness, 'unknown');
  assert.equal(workerStatus(repo, undefined, () => { throw Error('Offline'); }).choice, 'unknown');
  assert(f.calls.every(c => c.args[1] === 'list'));
});
test('certification refuses incomplete job lists even if the run reports success', () => {
  const f = fixture(); f.jobs.pop();
  assert.throws(() => certifyWorkers(repo, '42', sha, f.proof, { verify: f.p.verify.pool, deliver: f.p.deliver.pool }, f.run), /three test jobs/);
});

test('guided setup waits for its dispatched test and enables without copying a run or pool ID', async () => {
  const f = fixture(), watched: string[] = [], records: WorkerRecord[] = [];
  f.host.watch = async (repository, id) => { assert.equal(repository, repo); watched.push(id); assert.equal(f.variables.size, 0); };
  await configureWorkers({ choice: 'local', root: '/app', repo }, f.run, r => records.push(r), f.host);
  assert.deepEqual(watched, ['42']); assert.equal(records.at(-1)?.status, 'configured');
});
