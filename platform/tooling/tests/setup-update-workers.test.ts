import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { configureWorkers, certifyWorkers, setWorkerRouting, validateProofs, workerHost, type Proofs, type WorkerHost } from '../setup-updates/workers.ts';
import { workerStatus, WORKER_VARIABLES, type WorkerRecord } from '../setup-updates/worker-state.ts';
import { hash, updaterCheckWorkflow } from '../ci-workers/core.ts';
import { proofId } from '../ci-workers/proof.ts';
import { argumentsFor, main } from '../setup-updates.ts';
import { readRecord, saveRecord, summary, updateStatus } from '../setup-updates/state.ts';
import type { Gh } from '../setup-updates/github.ts';

const sha = 'a'.repeat(40), repo = 'owner/app';
function temporaryRoot(t: test.TestContext): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.worker-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('worker source allows only tracked unstaged, staged or untracked setup record changes', async t => {
  for (const state of ['unstaged', 'staged', 'untracked'] as const) await t.test(state, t => {
    const root = temporaryRoot(t);
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trimEnd();
    git('init');
    fs.writeFileSync(path.join(root, 'app.txt'), 'committed app');
    if (state !== 'untracked') saveRecord(root, 'deferred', repo, 'deferred', []);
    git('add', '.');
    git('-c', 'user.name=Worker test', '-c', 'user.email=worker@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Committed source');
    const committed = git('rev-parse', 'HEAD');
    saveRecord(root, 'deferred', repo, 'pending', ['Resume setup']);
    if (state === 'staged') git('add', '.github/update-delivery.json');
    const host = workerHost({ root, repo, choice: 'local' });
    assert.equal(host.sha(), committed);
    fs.writeFileSync(path.join(root, 'app.txt'), 'dirty app');
    assert.throws(() => host.sha(), /Only the setup record may be uncommitted/);
    git('add', 'app.txt');
    assert.throws(() => host.sha(), /Only the setup record may be uncommitted/);
    git('restore', '--staged', 'app.txt');
    git('restore', 'app.txt');
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'new app file');
    assert.throws(() => host.sha(), /Only the setup record may be uncommitted/);
  });
});
function recoveryArguments(action: string): string[] {
  const command = action.slice(action.indexOf('bun run platform:setup-updates ') + 'bun run platform:setup-updates '.length).split('. Routing')[0].replace(/\.$/, '');
  return JSON.parse(execFileSync('/bin/sh', ['-c', 'set -- ' + command + '; exec node -e \'console.log(JSON.stringify(process.argv.slice(1)))\' -- "$@"'], { encoding: 'utf8' }));
}
test('guided preparation resumes authenticated incomplete installations for both roles', async t => {
  const root = temporaryRoot(t);
  for (const role of ['verify', 'deliver'] as const) {
    const home = path.join(root, role); fs.mkdirSync(home);
    const config = { repo, updateRole: role, updateWorkflow: '.github/workflows/update-platform.yml', pool: 'starter-' + role, localOnly: false, paused: false };
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(home, 'token'), 'private-manager-credential');
    const calls: string[][] = [];
    const host = workerHost({ choice: 'local', root, repo }, async (selectedHome, args) => {
      assert.equal(selectedHome, home); calls.push(args);
      if (args[0] === 'setup') {
        assert.deepEqual(args, ['setup']);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), config);
        assert.equal(fs.readFileSync(path.join(home, 'token'), 'utf8'), 'private-manager-credential');
        fs.writeFileSync(path.join(home, 'daemon.lock'), 'running');
        fs.writeFileSync(path.join(home, 'status.json'), JSON.stringify({ polled: new Date().toISOString() }));
      }
    });
    await host.prepare(role, home);
    assert.deepEqual(calls, [['setup'], role === 'verify' ? ['check', '--install'] : ['check']]);
    calls.length = 0;
    await host.prepare(role, home);
    assert.deepEqual(calls, [role === 'verify' ? ['check', '--install'] : ['check']]);
  }
});
test('installed artifact truncation and missing receipts resume both roles without replacing identity or credentials', t => {
  const root = temporaryRoot(t);
  const modules = fileURLToPath(new URL('../ci-workers/', import.meta.url));
  const workers = fileURLToPath(new URL('../setup-updates/workers.ts', import.meta.url));
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    const { install, installationComplete, serviceDefinition } = await import(${JSON.stringify(modules + 'service.ts')});
    const { workerHost } = await import(${JSON.stringify(workers)});
    const home = process.env.STARTER_WORKERS_HOME;
    await fs.mkdir(home, { recursive: true });
    for (const role of ['verify', 'deliver']) {
      const c = { repo: 'owner/app', updateRole: role, updateWorkflow: '.github/workflows/update-platform.yml', pool: 'starter-' + role, localOnly: false, paused: false, docker: '/usr/bin/docker' };
      const configuration = JSON.stringify(c), credential = 'existing-private-manager-token';
      await fs.writeFile(path.join(home, 'config.json'), configuration);
      await fs.writeFile(path.join(home, 'token'), credential);
      await install(c);
      assert.equal(await installationComplete(c.pool), true);
      await fs.rm(serviceDefinition(c.pool));
      await fs.mkdir(serviceDefinition(c.pool));
      await assert.rejects(install(c), { code: 'EISDIR' });
      assert.equal(await installationComplete(c.pool), false);
      await fs.rm(serviceDefinition(c.pool), { recursive: true });
      const artifacts = [path.join(home, 'starter-workers'), path.join(home, 'current/cli.ts'), serviceDefinition(c.pool), path.join(home, 'installation.json')];
      for (const artifact of [...artifacts, null]) {
        if (artifact) await fs.writeFile(artifact, 'truncated');
        else await fs.rm(path.join(home, 'installation.json'));
        assert.equal(await installationComplete(c.pool), false);
        const calls = [];
        const host = workerHost({ root: process.cwd(), repo: c.repo, choice: 'local' }, async (directory, args) => {
          assert.equal(directory, home); calls.push(args);
          if (args[0] === 'setup') await install(c);
          if (args[0] === 'service') {
            assert.equal(await installationComplete(c.pool), true);
            await fs.writeFile(path.join(home, 'daemon.lock'), 'running');
            await fs.writeFile(path.join(home, 'status.json'), JSON.stringify({ polled: new Date().toISOString() }));
          }
        });
        await host.prepare(role, home);
        assert.deepEqual(calls, [['setup'], role === 'verify' ? ['check', '--install'] : ['check'], ['service', 'start']]);
        assert.equal(await fs.readFile(path.join(home, 'config.json'), 'utf8'), configuration);
        assert.equal(await fs.readFile(path.join(home, 'token'), 'utf8'), credential);
        execFileSync(path.join(home, 'starter-workers'), ['--help']);
        calls.length = 0;
        await host.prepare(role, home);
        assert.deepEqual(calls, [role === 'verify' ? ['check', '--install'] : ['check']]);
        const wrapper = path.join(home, 'starter-workers'), contents = await fs.readFile(wrapper);
        await fs.writeFile(wrapper, 'truncated while running');
        calls.length = 0;
        await host.prepare(role, home);
        assert.deepEqual(calls, [role === 'verify' ? ['check', '--install'] : ['check']]);
        await assert.rejects(install(c), /Stop the manager/);
        assert.equal(await fs.readFile(wrapper, 'utf8'), 'truncated while running');
        await fs.writeFile(wrapper, contents);
        assert.equal(await installationComplete(c.pool), true);
        await fs.rm(path.join(home, 'daemon.lock'));
        calls.length = 0;
        await host.prepare(role, home);
        assert.deepEqual(calls, [role === 'verify' ? ['check', '--install'] : ['check'], ['service', 'start']]);
        await fs.rm(path.join(home, 'daemon.lock'));
      }
    }
  `], { env: { ...process.env, HOME: root, STARTER_WORKERS_HOME: path.join(root, 'installation') }, stdio: 'pipe' });
});
test('last successful worker test survives pending, offline, dispatched and hosted transitions independently of readiness', async t => {
  const root = temporaryRoot(t), cwd = process.cwd(), f = fixture();
  fs.writeFileSync(path.join(root, '.platform-base.json'), '{}');
  const historical = { runId: 42, sha, proof: f.proof, checkedAt: '2026-10-04T12:00:00Z' };
  const seed = () => {
    f.variables.set(WORKER_VARIABLES.verify, f.p.verify.pool);
    f.variables.set(WORKER_VARIABLES.deliver, f.p.deliver.pool);
    saveRecord(root, 'deferred', repo, 'deferred', [], { workers: { choice: 'local', status: 'configured', pools: { verify: f.p.verify.pool, deliver: f.p.deliver.pool }, test: historical, ownerActions: [] } });
  };
  process.chdir(root); t.after(() => process.chdir(cwd));
  for (const scenario of ['consent', 'offline', 'dispatch', 'hosted'] as const) {
    seed();
    f.host.prepare = async () => { assert.deepEqual(readRecord(root)!.workers!.test, historical); };
    f.host.watch = async () => { assert.deepEqual(readRecord(root)!.workers!.test, historical); throw Error('Interrupted'); };
    const offline: Gh = () => { throw Error('Offline'); };
    const args = ['--workers', scenario === 'hosted' ? 'hosted' : 'local', ...(scenario === 'consent' ? [] : ['--yes'])];
    const run = scenario === 'offline' ? offline : f.run;
    assert.equal(await main(args, run, undefined, f.host), scenario === 'offline' || scenario === 'dispatch' ? 2 : 0);
    const saved = readRecord(root)!.workers!;
    assert.deepEqual(saved.test, historical);
    const status = workerStatus(repo, saved, run);
    assert.deepEqual(status.lastTest, historical);
    assert.equal(status.readiness, scenario === 'hosted' ? 'ready' : scenario === 'offline' ? 'unknown' : 'blocked');
    assert(summary(updateStatus(root, repo, run)).includes('Last worker test: run=42; source=' + sha));
  }
  seed();
  assert.equal(await main(['--workers', 'local', '--worker-run', '42', '--yes'], f.run, undefined, f.host), 0);
  assert.notEqual(readRecord(root)!.workers!.test!.checkedAt, historical.checkedAt);
  assert.equal(workerStatus(repo, readRecord(root)!.workers, f.run).readiness, 'ready');
});
test('pending consent and interrupted monitoring retain executable recovery arguments and resume the existing test', async t => {
  const root = temporaryRoot(t), cwd = process.cwd(), f = fixture();
  fs.writeFileSync(path.join(root, '.platform-base.json'), '{}');
  saveRecord(root, 'deferred', repo, 'deferred', []);
  process.chdir(root); t.after(() => process.chdir(cwd));
  const homes = { verify: path.join(root, "verify's $pool"), deliver: path.join(root, 'deliver `pool`') };
  const args = ['--repo', repo, '--workers', 'local', '--verify-home', homes.verify, '--deliver-home', homes.deliver];
  assert.equal(await main(args, f.run, undefined, f.host), 0);
  let saved = readRecord(root)!.workers!;
  assert.deepEqual(argumentsFor(recoveryArguments(saved.ownerActions[0])), argumentsFor([...args, '--yes']));
  f.host.watch = async () => { throw Error('Monitoring interrupted'); };
  assert.equal(await main([...args, '--yes'], f.run, undefined, f.host), 2);
  saved = readRecord(root)!.workers!;
  assert.deepEqual(saved.homes, homes);
  assert(saved.ownerActions.includes('Monitoring interrupted'));
  const resume = recoveryArguments(saved.ownerActions[0]);
  assert.deepEqual(argumentsFor(resume), argumentsFor([...args, '--worker-run', '42', '--yes']));
  const status = workerStatus(repo, saved, f.run);
  assert(status.ownerActions.includes(saved.ownerActions[0]));
  f.prepared.length = 0;
  assert.equal(await main(resume, f.run, undefined, f.host), 0);
  assert.deepEqual(f.prepared, []);
  assert.equal(f.calls.filter(c => c.args[1].endsWith('/dispatches')).length, 1);
  assert.equal(readRecord(root)!.workers!.test!.runId, 42);
});
test('human worker status includes unknown availability and the recorded test identities and time', t => {
  const root = temporaryRoot(t), f = fixture();
  const checkedAt = '2026-10-04T12:00:00Z';
  saveRecord(root, 'deferred', repo, 'deferred', [], { workers: { choice: 'local', status: 'configured', pools: { verify: f.p.verify.pool, deliver: f.p.deliver.pool }, test: { runId: 42, sha, proof: f.proof, checkedAt }, ownerActions: [] } });
  const output = summary(updateStatus(root, repo, f.run));
  assert(output.includes('Worker host availability: unknown'));
  assert(output.includes('Last worker test: run=42; source=' + sha + '; proof=' + f.proof + '; checked=' + checkedAt));
  saveRecord(root, 'deferred', repo, 'deferred', [], { workers: undefined });
  assert(summary(updateStatus(root, undefined, () => { throw Error('offline'); })).includes('Last worker test: none'));
});
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

test('diagnostic workflow requires manual dispatch and separates verification from tools-only delivery', () => {
  const file = fileURLToPath(new URL('../../../.github/workflows/platform-update-workers-check.yml', import.meta.url));
  const workflow = JSON.parse(execFileSync('bun', ['-e', 'console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))', file], { encoding: 'utf8' }));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.jobs), ['check', 'verify', 'deliver']);
  assert.equal(workflow.jobs.verify.needs, 'check'); assert.equal(workflow.jobs.deliver.needs, 'verify');
  assert.deepEqual(workflow.permissions, { contents: 'read' }); assert.deepEqual(workflow.jobs.deliver.permissions, {});
  for (const [name, job] of Object.entries(workflow.jobs) as [string, { 'runs-on': string[]; steps: { uses?: string }[] }][]) {
    assert.equal(job['runs-on'].length, 6); assert.equal(job['runs-on'][0], 'self-hosted'); assert.equal(job['runs-on'].at(-1), 'starter-update-' + name);
    if (name !== 'verify') assert(job.steps.every(step => !step.uses));
  }
  assert.equal(workflow.jobs.verify.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false);
});
