import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './core.ts';

const modules = path.dirname(fileURLToPath(import.meta.url));
const image = `sha256:${'a'.repeat(64)}`;
async function fixture(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const parent = path.join(process.cwd(), '.ci-local-artifacts');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'worker-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'pool'));
  await writeFile(path.join(directory, 'docker.cjs'), `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const home = process.env.STARTER_WORKERS_HOME;
const file = path.join(home, 'docker.json');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { calls: [], workers: {}, tags: {}, builds: 0 };
const args = process.argv.slice(4);
state.calls.push(args);
let output = '', failure = false;
if (args[0] === 'info') output = JSON.stringify({ OSType: 'linux', Architecture: 'arm64' });
if (args[0] === 'buildx' && args[1] === 'build') {
  state.builds++;
  state.tags[args[args.indexOf('--tag') + 1]] = 'sha256:' + String(state.builds).padStart(64, '0');
}
if (args[0] === 'image' && args[1] === 'inspect') {
  if (args.includes('--format')) output = args.includes('{{.Id}}') ? state.tags[args.at(-1)] : 'node@sha256:' + 'b'.repeat(64);
  else if (args.includes('{{.Size}}')) output = '100';
}
if (args[0] === 'inspect') {
  if (args.includes('-f')) output = '172.20.0.2';
  else output = JSON.stringify([{ Image: state.workers[args[1]].image, Mounts: [], HostConfig: { Privileged: false, RestartPolicy: { Name: 'no' } } }]);
}
if (args[0] === 'create' && args.includes('--cpus')) {
  const id = args[args.indexOf('--name') + 1];
  const imageIndex = args.findIndex(a => /^sha256:/.test(a));
  state.workers[id] = { image: args[imageIndex], mode: args[imageIndex + 1], env: args.flatMap((a, i) => a === '--env' ? [args[i + 1]] : []) };
}
if (args[0] === 'cp') {
  state.source = cp.execFileSync('tar', ['-xOf', args[1], 'source.txt'], { encoding: 'utf8' });
}
if (args[0] === 'start' && args[1] === '-ai') {
  const worker = state.workers[args[2]];
  if (worker.mode === 'exec') { state.validations = (state.validations || 0) + 1; failure = fs.existsSync(path.join(home, 'fail-validation')); }
  output = 'ok';
}
fs.writeFileSync(file, JSON.stringify(state));
if (failure) { console.error('offline install failed'); process.exit(1); }
process.stdout.write(output);
`, { mode: 0o755 });
  return directory;
}
async function run(directory: string, code: string, pool = 'pool'): Promise<string> {
  const script = path.join(directory, 'run.mjs');
  await writeFile(script, `import assert from 'node:assert/strict';\nimport * as fs from 'node:fs/promises';\nimport path from 'node:path';\nconst base = ${JSON.stringify(modules)};\nconst core = await import(path.join(base, 'core.ts'));\nconst c = { pool: ${JSON.stringify(pool)}, repo: 'owner/repo', cpus: 2, memoryGiB: 4, diskGiB: 40, context: 'test', docker: ${JSON.stringify(path.join(directory, 'docker.cjs'))} };\n${code}`);
  return command(process.execPath, [script], { env: { ...process.env, HOME: directory, STARTER_WORKERS_HOME: path.join(directory, pool) } });
}

test('teardown survives evidence and log persistence failures and uses Node proxy mode', async t => {
  const dir = await fixture(t);
  for (const blocked of ['logs', 'evidence']) {
    await rm(path.join(dir, 'pool', blocked), { recursive: true, force: true });
    await writeFile(path.join(dir, 'pool', blocked), 'not a directory');
    await run(dir, `const { launch } = await import(path.join(base, 'runtime.ts')); await assert.rejects(launch(c, ${JSON.stringify(image)}, ['smoke']));`);
    const state = JSON.parse(await readFile(path.join(dir, 'pool/docker.json'), 'utf8'));
    const calls: string[][] = state.calls;
    assert.deepEqual(calls.slice(-4).map(a => a[0]), ['rm', 'rm', 'rm', 'network']);
    assert.equal(calls.at(-1)?.[1], 'rm');
    for (const worker of Object.values(state.workers) as { env: string[] }[]) assert(worker.env.includes('NODE_USE_ENV_PROXY=1'));
    await rm(path.join(dir, 'pool', blocked), { force: true });
  }
});

test('locks recover unpublished and dead owners, reject contention, and release failed actions', async t => {
  const dir = await fixture(t);
  await run(dir, `
const { lock } = await import(path.join(base, 'manager.ts'));
for (const kind of ['empty', 'dead']) {
  const directory = path.join(core.home, 'mutation.lock');
  await fs.mkdir(directory);
  if (kind === 'dead') await fs.writeFile(path.join(directory, 'pid'), '2147483647');
  await lock('mutation', async () => {
    await assert.rejects(lock('mutation', async () => assert.fail('overlapping owner')), /Another worker operation/);
  });
  assert.equal(await core.exists(directory), false);
}
await assert.rejects(lock('daemon', async () => { throw new Error('failure'); }), /failure/);
assert.equal(await core.exists(path.join(core.home, 'daemon.lock')), false);
`);
});

test('separate installations keep service executables and convenience ownership independent', async t => {
  const dir = await fixture(t);
  await mkdir(path.join(dir, 'second'));
  const install = `const { install } = await import(path.join(base, 'service.ts')); await core.save(path.join(core.home, 'config.json'), c); process.stdout.write(await install(c));`;
  const first = await run(dir, install);
  const second = await run(dir, install, 'second');
  assert.equal(first, path.join(dir, 'pool/starter-workers'));
  assert.equal(second, path.join(dir, 'second/starter-workers'));
  const firstState = JSON.parse(await command(first, ['status']));
  const secondState = JSON.parse(await command(second, ['status']));
  assert.equal(firstState.pool, 'pool');
  assert.equal(secondState.pool, 'second');
  await run(dir, `const { removeConvenienceCommand } = await import(path.join(base, 'service.ts')); await removeConvenienceCommand();`);
  assert.equal(JSON.parse(await command(path.join(dir, '.local/bin/starter-workers'), ['status'])).pool, 'second');
  await run(dir, `const { removeConvenienceCommand } = await import(path.join(base, 'service.ts')); await removeConvenienceCommand();`, 'second');
  await assert.rejects(readFile(path.join(dir, '.local/bin/starter-workers')), { code: 'ENOENT' });
});

test('command timeout terminates its descendant before returning', async t => {
  const dir = await fixture(t);
  const pid = path.join(dir, 'child.pid');
  const parent = path.join(dir, 'parent.cjs');
  await writeFile(parent, `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(pid)}, String(child.pid)); setInterval(() => {}, 1000);`);
  await assert.rejects(command(process.execPath, [parent], { timeout: 500 }));
  const child = Number(await readFile(pid, 'utf8'));
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(child, 0); } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH'); return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('descendant survived command cancellation');
});

test('failed refresh preserves active tools and catalog until exact-source offline validation passes', async t => {
  const dir = await fixture(t);
  const git = (...args: string[]): Promise<string> => command('git', ['-C', dir, ...args]);
  await git('init'); await git('config', 'user.name', 'test'); await git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(dir, 'package.json'), '{"packageManager":"bun@1.4.2","devDependencies":{"@playwright/test":"1.63.0"}}');
  await writeFile(path.join(dir, '.node-version'), '24');
  await writeFile(path.join(dir, 'bun.lock'), '{"playwright": ["playwright@1.63.0"]}');
  await writeFile(path.join(dir, 'source.txt'), 'committed source');
  await git('add', 'package.json', '.node-version', 'bun.lock', 'source.txt'); await git('commit', '-m', 'fixture');
  const sha = await git('rev-parse', 'HEAD');
  await writeFile(path.join(dir, 'source.txt'), 'uncommitted poison');
  const prepare = `
const bytes = Buffer.from('download fixture');
globalThis.fetch = async url => {
  url = String(url);
  if (!url.startsWith('https://api.github.com')) return new Response(bytes);
  const repo = url.split('/').slice(4, 6).join('/');
  const name = repo === 'actions/runner' ? 'actions-runner-linux-arm64-1.0.0.tar.gz' : repo === 'oven-sh/bun' ? 'bun-linux-aarch64.zip' : 'convex-local-backend-aarch64-unknown-linux-gnu.zip';
  return Response.json({ tag_name: 'v1.0.0', assets: [{ name, digest: 'sha256:' + core.hash(bytes), browser_download_url: 'https://github.com/' + repo + '/releases/download/v1.0.0/' + name }] });
};
const { prepare } = await import(path.join(base, 'images.ts'));
await prepare(c, ${JSON.stringify(dir)}, ${JSON.stringify(sha)}, 'branch-test', true);
`;
  await run(dir, prepare);
  const catalog = await readFile(path.join(dir, 'pool/catalog.json'), 'utf8');
  const builds = path.join(dir, 'pool/builds');
  const { readdir } = await import('node:fs/promises');
  const [build] = await readdir(builds);
  const meta = path.join(builds, build, 'tools.json');
  const tools = await readFile(meta, 'utf8');
  await writeFile(path.join(dir, 'pool/fail-validation'), 'fail');
  await assert.rejects(run(dir, prepare), /offline install failed/);
  assert.equal(await readFile(meta, 'utf8'), tools);
  assert.equal(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8'), catalog);
  await rm(path.join(dir, 'pool/fail-validation'));
  await run(dir, prepare);
  assert.notEqual(await readFile(meta, 'utf8'), tools);
  const state = JSON.parse(await readFile(path.join(dir, 'pool/docker.json'), 'utf8'));
  assert.equal(state.source, 'committed source');
  assert.equal(state.validations, 3);
  assert.equal(state.calls.some((a: string[]) => a[0] === 'commit'), false);
});

test('update allows preparation longer than the ordinary command budget', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'platform/tooling/ci-workers');
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'cli.ts'), 'setTimeout(() => process.exit(0), 250);');
  await run(dir, `
await core.save(path.join(core.home, 'config.json'), c);
const timeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => timeout(callback, delay === 120_000 ? 50 : delay, ...args);
const { main } = await import(path.join(base, 'cli.ts'));
await main(['update', '--from', ${JSON.stringify(dir)}]);
`);
});
