import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const crypto = require('node:crypto');
const path = require('node:path');
const home = process.env.STARTER_WORKERS_HOME;
const file = path.join(home, 'docker.json');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { calls: [], workers: {}, tags: {}, images: {}, builds: 0, seedBases: [] };
const args = process.argv.slice(4);
state.calls.push(args);
let output = '', failure = false;
if (args[0] === 'info') output = JSON.stringify({ OSType: 'linux', Architecture: 'arm64', MemTotal: 32 * 1024 ** 3, NCPU: 8 });
if (args[0] === 'buildx' && args[1] === 'build') {
  state.builds++;
  const id = 'sha256:' + String(state.builds).padStart(64, '0');
  const tag = args[args.indexOf('--tag') + 1];
  const target = args[args.indexOf('--target') + 1];
  const directory = args.at(-1);
  const digest = bytes => 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
  let config, marker, base;
  if (target === 'tools') {
    marker = fs.readFileSync(path.join(directory, 'downloads/backend.zip'), 'utf8');
    config = { architecture: 'arm64', os: 'linux', rootfs: { diff_ids: [digest(marker)] }, config: { Env: ['TOOL_BYTES=' + marker], User: '1001:1001' } };
    const configBytes = JSON.stringify(config), configDigest = digest(configBytes);
    const manifestBytes = JSON.stringify({ config: { digest: configDigest } }), manifestDigest = digest(manifestBytes);
    const exporter = args.find(a => a.startsWith('type=oci,'));
    if (exporter) {
      const layout = exporter.split(',').find(a => a.startsWith('dest=')).slice(5);
      fs.mkdirSync(path.join(layout, 'blobs/sha256'), { recursive: true });
      fs.writeFileSync(path.join(layout, 'index.json'), JSON.stringify({ manifests: [{ digest: manifestDigest }] }));
      fs.writeFileSync(path.join(layout, 'blobs/sha256', manifestDigest.slice(7)), manifestBytes);
      fs.writeFileSync(path.join(layout, 'blobs/sha256', configDigest.slice(7)), configBytes);
    }
    base = id;
  } else {
    const context = args[args.indexOf('--build-context') + 1];
    if (context && context.startsWith('validated-tools=oci-layout://')) {
      const [layout, manifest] = context.slice('validated-tools=oci-layout://'.length).split('@');
      const document = JSON.parse(fs.readFileSync(path.join(layout, 'blobs/sha256', manifest.slice(7))));
      config = JSON.parse(fs.readFileSync(path.join(layout, 'blobs/sha256', document.config.digest.slice(7))));
      marker = config.config.Env[0].slice('TOOL_BYTES='.length);
      base = Object.keys(state.images).find(key => state.images[key].marker === marker && state.images[key].target === 'tools');
    } else {
      marker = fs.readFileSync(path.join(directory, 'downloads/backend.zip'), 'utf8');
      config = { architecture: 'arm64', os: 'linux', rootfs: { diff_ids: [digest(marker + 'rebuilt-apt')] }, config: { Env: ['TOOL_BYTES=' + marker] } };
    }
    state.seedBases.push({ image: base, bytes: marker });
  }
  state.tags[tag] = id;
  state.images[id] = { Id: id, Created: new Date().toISOString(), Architecture: config.architecture, Os: config.os, RootFS: { Layers: config.rootfs.diff_ids }, Config: config.config, target, marker };
  failure = fs.existsSync(path.join(home, 'fail-build-' + target));
}
if (args[0] === 'tag') state.tags[args[2]] = args[1];
if (args[0] === 'image' && args[1] === 'rm') for (const tag of args.slice(2)) { if (!state.tags[tag] || fs.existsSync(path.join(home, 'fail-rm-' + tag.split(':')[1]))) failure = true; else delete state.tags[tag]; }
if (args[0] === 'image' && args[1] === 'ls') output = Object.keys(state.tags).filter(tag => !args.some(a => a.startsWith('reference=')) || args.includes('reference=' + tag)).join('\\n');
if (args[0] === 'image' && args[1] === 'inspect') {
  const id = state.tags[args.at(-1)] || args.at(-1);
  if (args.includes('--format')) output = args.includes('{{.Id}}') ? id : 'node@sha256:' + 'b'.repeat(64);
  else if (args.includes('{{.Size}}')) output = '100';
  else if (state.images[id]) output = JSON.stringify([state.images[id]]);
  else failure = true;
}
if (args[0] === 'ps') output = Object.keys(state.leased || {}).join('\\n');
if (args[0] === 'inspect') {
  if (args.includes('-f')) output = args.includes('{{.Image}}') ? state.leased[args.at(-1)] : '172.20.0.2';
  else output = JSON.stringify([{ Image: state.workers[args[1]].image, Mounts: [], HostConfig: { Privileged: false, RestartPolicy: { Name: 'no' } } }]);
}
if (args[0] === 'create' && args.includes('--cpus')) {
  const id = args[args.indexOf('--name') + 1];
  const imageIndex = args.findIndex(a => /^sha256:/.test(a));
  state.workers[id] = { image: args[imageIndex], mode: args[imageIndex + 1], env: args.flatMap((a, i) => a === '--env' ? [args[i + 1]] : []) };
}
if (args[0] === 'cp' && args[1] === '-') {
  const archive = fs.readFileSync(0);
  const octal = (offset, width) => parseInt(archive.subarray(offset, offset + width).toString().replaceAll('\\0', ''), 8);
  state.assignment = { uid: octal(108, 8), gid: octal(116, 8), mode: octal(100, 8), expected: JSON.parse(archive.subarray(512, 512 + octal(124, 12))) };
}
if (args[0] === 'cp' && args[1] !== '-') {
  state.source = cp.execFileSync('tar', ['-xOf', args[1], 'source.txt'], { encoding: 'utf8' });
}
if (args[0] === 'start' && args[1] === '-ai') {
  const worker = state.workers[args[2]];
  if (worker.mode === 'exec' && state.calls.findLast(a => a[0] === 'create' && a.includes(args[2])).includes('--version')) output = 'v24.21.0';
  else if (worker.mode === 'exec') { state.validations = (state.validations || 0) + 1; failure = fs.existsSync(path.join(home, 'fail-validation')); }
  if (worker.mode === 'smoke') failure = fs.existsSync(path.join(home, 'fail-smoke-' + state.images[worker.image]?.target));
  output ||= 'ok';
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
  await writeFile(parent, `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' }); fs.writeFileSync(process.argv[2], String(child.pid)); setInterval(() => {}, 1000);`);
  await assert.rejects(command(process.execPath, [parent, pid], { timeout: 500 }));
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
  await writeFile(path.join(dir, 'package.json'), '{"packageManager":"bun@1.4.2","engines":{"node":"24.x"},"devDependencies":{"@playwright/test":"1.63.0"}}');
  await writeFile(path.join(dir, '.node-version'), '24');
  await writeFile(path.join(dir, 'bun.lock'), '{"lockfileVersion":1,"workspaces":{},"packages":{"playwright":["playwright@1.63.0","",{},"sha512-YQ=="]}}');
  await writeFile(path.join(dir, 'source.txt'), 'committed source');
  await git('add', 'package.json', '.node-version', 'bun.lock', 'source.txt'); await git('commit', '-m', 'fixture');
  const sha = await git('rev-parse', 'HEAD');
  await writeFile(path.join(dir, 'source.txt'), 'uncommitted poison');
  const prepare = `
const bytes = Buffer.from(await fs.readFile(path.join(core.home, 'release'), 'utf8').catch(() => 'download fixture'));
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
  // A delivery installation must succeed even when app installation is poisoned.
  await writeFile(path.join(dir, 'pool/fail-validation'), 'fail');
  await run(dir, prepare.replace('await prepare(c,', "await prepare({ ...c, updateRole: 'deliver' },"));
  const writer = JSON.parse(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8'));
  assert.equal(writer.environments.length, 0);
  assert(writer.tools);
  const operations = JSON.parse(await readFile(path.join(dir, 'pool/docker.json'), 'utf8')).calls as string[][];
  assert.equal(operations.filter(args => args[0] === 'cp' && args.some(arg => arg.endsWith('/work/source.tar'))).length, 0);
  assert.equal(operations.filter(args => args.includes('--target') && args[args.indexOf('--target') + 1] === 'worker').length, 0);
  await rm(path.join(dir, 'pool/fail-validation'));
  await run(dir, prepare);
  await writeFile(path.join(dir, 'app.ts'), 'export const sourceOnly = true;');
  await git('add', 'app.ts'); await git('commit', '-m', 'source-only change');
  const warmSha = await git('rev-parse', 'HEAD');
  await run(dir, prepare.replace(JSON.stringify(sha), JSON.stringify(warmSha)).replace("'branch-test', true", "'branch-test', false"));
  assert.equal(JSON.parse(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8')).environments[0].source, warmSha);
  const catalog = await readFile(path.join(dir, 'pool/catalog.json'), 'utf8');
  const tools = JSON.parse(catalog).tools;
  await writeFile(path.join(dir, 'pool/release'), 'new tool bytes');
  await writeFile(path.join(dir, 'pool/fail-validation'), 'fail');
  await assert.rejects(run(dir, prepare), /offline install failed/);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8')).tools, tools);
  assert.deepEqual(await readdir(path.join(dir, 'pool/candidates')), []);
  assert.equal(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8'), catalog);
  await rm(path.join(dir, 'pool/fail-validation'));
  const retainedTags = Object.keys(JSON.parse(await readFile(path.join(dir, 'pool/docker.json'), 'utf8')).tags).sort();
  for (const failure of ['fail-build-tools', 'fail-smoke-tools', 'fail-build-worker', 'fail-smoke-worker']) {
    const marker = path.join(dir, 'pool', failure);
    await writeFile(marker, 'fail');
    await assert.rejects(run(dir, prepare), /failed/);
    await rm(marker);
    assert.equal(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8'), catalog);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(dir, 'pool/docker.json'), 'utf8')).tags).sort(), retainedTags);
    assert.deepEqual(await readdir(path.join(dir, 'pool/candidates')), []);
  }
  await writeFile(path.join(dir, 'bun.lock'), '{"lockfileVersion":1,"workspaces":{},"packages":{"playwright":["playwright@1.63.0","",{},"sha512-Yg=="]}}');
  await git('add', 'bun.lock'); await git('commit', '-m', 'dependency change');
  const nextSha = await git('rev-parse', 'HEAD');
  await run(dir, prepare.replace(JSON.stringify(sha), JSON.stringify(nextSha)).replace("'branch-test', true", "'branch-test', false"));
  const warm = JSON.parse(await readFile(path.join(dir, 'pool/docker.json'), 'utf8'));
  assert.equal(warm.seedBases.at(-1).image, tools);
  assert.equal(warm.seedBases.at(-1).bytes, 'download fixture');
  const beforeFloor = await readFile(path.join(dir, 'pool/catalog.json'), 'utf8');
  const manifestText = await readFile(path.join(dir, 'package.json'), 'utf8');
  await writeFile(path.join(dir, 'package.json'), manifestText.replace('24.x', '>=24.22 <25'));
  await git('add', 'package.json'); await git('commit', '-m', 'new Node floor');
  const floorSha = await git('rev-parse', 'HEAD');
  await assert.rejects(run(dir, prepare.replace(JSON.stringify(sha), JSON.stringify(floorSha)).replace("'branch-test', true", "'branch-test', false")), /below engines.node floor/);
  assert.equal(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8'), beforeFloor);
  await run(dir, prepare);
  assert.notEqual(JSON.parse(await readFile(path.join(dir, 'pool/catalog.json'), 'utf8')).tools, tools);
  const state = JSON.parse(await readFile(path.join(dir, 'pool/docker.json'), 'utf8'));
  assert.equal(state.source, 'committed source');
  assert.equal(state.validations, 4);
  assert.equal(Object.keys(state.tags).some(tag => tag.includes('-candidate-')), false);
  assert.deepEqual(await readdir(path.join(dir, 'pool/candidates')), []);
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

test('cleanup collects crash orphans and protects retained, leased and recently used closed-PR seeds', async t => {
  const dir = await fixture(t);
  await run(dir, `
Object.defineProperty(process, 'platform', { value: 'linux' });
await fs.writeFile(path.join(core.home, 'credential'), 'test');
globalThis.fetch = async () => Response.json({ state: 'closed', closed_at: new Date(Date.now() - 10 * 86400_000).toISOString() });
const now = new Date().toISOString(), old = new Date(Date.now() - 10 * 86400_000).toISOString();
const id = n => 'sha256:' + String(n).padStart(64, '0');
const env = (n, used) => ({ key: core.hash(String(n)), image: id(n), tools: id(10), scope: 'pr-7', source: '${'a'.repeat(40)}', used, created: old, bytes: 100 });
const environments = [env(1, now), env(2, old), env(3, old)];
const state = { environments, tools: id(10), toolchains: { retained: { image: id(10), manifest: id(99), created: old }, expired: { image: id(11), manifest: id(98), created: old } } };
await core.save(path.join(core.home, 'catalog.json'), state);
const tags = Object.fromEntries(environments.map(e => ['pool:seed-' + e.key.slice(0, 24), e.image]));
Object.assign(tags, { 'pool:seed-orphan': id(4), 'pool:seed-candidate-crash': id(5), 'pool:tools-candidate-crash': id(12), 'pool:tools-retained': id(10), 'pool:tools-candidate-promoted': id(10), 'pool:tools-expired': id(11), 'other:seed-unowned': id(13) });
const images = Object.fromEntries(Object.values(tags).map(image => [image, { Id: image, Created: old }]));
await core.save(path.join(core.home, 'docker.json'), { calls: [], workers: {}, tags, images, builds: 0, leased: { running: id(3) } });
for (const image of [id(10), id(11), id(12)]) await fs.mkdir(path.join(core.home, 'tool-layouts', image.slice(7)), { recursive: true });
for (const folder of ['candidates/crash', 'builds/legacy', 'downloads']) { await fs.mkdir(path.join(core.home, folder), { recursive: true }); await fs.writeFile(path.join(core.home, folder, 'private-input'), 'staging'); }
const { cleanup } = await import(path.join(base, 'manager.ts'));
const before = await fs.readFile(path.join(core.home, 'catalog.json'), 'utf8');
const expected = [id(2), id(4), id(5), id(10), id(11), id(12)].sort();
assert.deepEqual((await cleanup(c, true)).sort(), expected);
assert.equal(await fs.readFile(path.join(core.home, 'catalog.json'), 'utf8'), before);
assert(await core.exists(path.join(core.home, 'candidates/crash')));
assert.deepEqual(Object.keys((await core.readJson(path.join(core.home, 'docker.json'))).tags).sort(), Object.keys(tags).sort());
assert.deepEqual((await cleanup(c, false)).sort(), expected);
const result = await core.catalog();
assert.deepEqual(result.environments.map(e => e.image), [id(1), id(3)]);
assert.equal(result.toolchains.expired, undefined);
const remaining = (await core.readJson(path.join(core.home, 'docker.json'))).tags;
assert.deepEqual(Object.keys(remaining).sort(), ['pool:seed-' + environments[0].key.slice(0, 24), 'pool:seed-' + environments[2].key.slice(0, 24), 'pool:tools-retained', 'other:seed-unowned'].sort());
assert(await core.exists(path.join(core.home, 'tool-layouts', id(10).slice(7))));
for (const image of [id(11), id(12)]) assert.equal(await core.exists(path.join(core.home, 'tool-layouts', image.slice(7))), false);
for (const folder of ['candidates', 'builds', 'downloads']) assert.equal(await core.exists(path.join(core.home, folder)), false);
`);
});

test('cleanup retries absent tags but retains catalog on real deletion failure; live log survives', async t => {
  const dir = await fixture(t);
  await run(dir, `
const old = new Date(Date.now() - 10 * 86400_000).toISOString();
const env = n => ({ key: core.hash(String(n)), image: 'sha256:' + String(n).padStart(64, '0'), tools: '${image}', scope: 'pr-8', source: '${'a'.repeat(40)}', used: old, created: old, bytes: 1 });
const environments = [env(1), env(2)];
const tags = Object.fromEntries(environments.map(e => ['pool:seed-' + e.key.slice(0, 24), e.image]));
await core.save(path.join(core.home, 'catalog.json'), { environments });
await core.save(path.join(core.home, 'docker.json'), { calls: [], workers: {}, tags, images: {}, builds: 0 });
const marker = path.join(core.home, 'fail-rm-' + Object.keys(tags)[1].split(':')[1]);
await fs.writeFile(marker, 'failure');
const { cleanup } = await import(path.join(base, 'manager.ts'));
await assert.rejects(cleanup({ ...c, localOnly: true }, false));
assert.equal((await core.catalog()).environments.length, 2);
await fs.rm(marker);
await fs.mkdir(path.join(core.home, 'logs'));
for (const file of ['manager.log', 'disposable.log']) { const target = path.join(core.home, 'logs', file); await fs.writeFile(target, 'log'); await fs.utimes(target, new Date(old), new Date(old)); }
await cleanup({ ...c, localOnly: true }, false);
assert.equal((await core.catalog()).environments.length, 0);
assert.equal(await fs.readFile(path.join(core.home, 'logs/manager.log'), 'utf8'), 'log');
assert.equal(await core.exists(path.join(core.home, 'logs/disposable.log')), false);
`);
});

test('drain requires current pause acknowledgement and all admitted work to finish', async t => {
  const dir = await fixture(t);
  await run(dir, `
await core.save(path.join(core.home, 'config.json'), c);
await fs.mkdir(path.join(core.home, 'daemon.lock'));
await core.save(path.join(core.home, 'status.json'), { pauseRequest: 'old', paused: true, active: [] });
const { main } = await import(path.join(base, 'cli.ts'));
let finished = false;
const draining = main(['pause', '--drain']).then(() => { finished = true; });
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(finished, false);
const paused = await core.config();
await core.save(path.join(core.home, 'status.json'), { pauseRequest: paused.pauseRequest, paused: true, active: [123] });
await new Promise(resolve => setTimeout(resolve, 1100));
assert.equal(finished, false);
await core.save(path.join(core.home, 'status.json'), { pauseRequest: paused.pauseRequest, paused: true, active: [] });
await draining;
`);
});

test('local proof rejects changed policies, refreshed images, stale time and unrelated runs', async t => {
  const dir = await fixture(t);
  await run(dir, `
const { localProof, proofId, certify } = await import(path.join(base, 'proof.ts'));
const { runtimePolicy } = await import(path.join(base, 'runtime.ts'));
const proof = { id: '12345678-1234-1234-1234-123456789abc', sha: '${'a'.repeat(40)}', image: '${image}', runtime: core.hash(JSON.stringify(runtimePolicy(c))), pool: c.pool, key: 'key', scope: 'branch-test', checked: new Date().toISOString() };
proof.id = proofId(proof);
await core.save(path.join(core.home, 'local-check.json'), proof);
await core.save(path.join(core.home, 'catalog.json'), { environments: [{ key: proof.key, source: proof.sha, image: proof.image, scope: proof.scope, used: proof.checked }] });
assert.deepEqual(await localProof(c), proof);
certify(proof, { head_sha: proof.sha, display_title: 'Worker check ' + proof.id });
for (const run of [{ head_sha: '${'b'.repeat(40)}', display_title: 'Worker check ' + proof.id }, { head_sha: proof.sha, display_title: 'old check' }]) assert.throws(() => certify(proof, run));
await assert.rejects(localProof({ ...c, cpus: 3 }));
await core.save(path.join(core.home, 'catalog.json'), { environments: [] });
await assert.rejects(localProof(c));
await core.save(path.join(core.home, 'local-check.json'), { ...proof, checked: new Date(Date.now() - 86400_001).toISOString() });
await assert.rejects(localProof(c));
assert.notEqual(core.installationPool(), core.installationPool());
`);
  const verifier = path.join(modules, 'recipe/verify-proof.mjs');
  const env = { ...process.env, EXPECTED_SHA: 'a'.repeat(40), GITHUB_SHA: 'a'.repeat(40), EXPECTED_IMAGE: image, STARTER_WORKER_IMAGE: image, EXPECTED_RUNTIME: 'b'.repeat(64), STARTER_WORKER_RUNTIME: 'b'.repeat(64) };
  const { hash } = await import('./core.ts');
  Object.assign(env, { EXPECTED_POOL: 'pool', EXPECTED_CHECKED: new Date().toISOString() });
  const expected = env as typeof env & { EXPECTED_POOL: string; EXPECTED_CHECKED: string; EXPECTED_PROOF: string };
  expected.EXPECTED_PROOF = hash(JSON.stringify([env.EXPECTED_SHA, env.EXPECTED_IMAGE, env.EXPECTED_RUNTIME, expected.EXPECTED_POOL, expected.EXPECTED_CHECKED]));
  await command(process.execPath, [verifier], { env });
  for (const key of ['GITHUB_SHA', 'STARTER_WORKER_IMAGE', 'STARTER_WORKER_RUNTIME', 'EXPECTED_PROOF']) await assert.rejects(command(process.execPath, [verifier], { env: { ...env, [key]: 'wrong' } }));
});

test('manager rereads pause before admitting queued jobs and acknowledges it at the scheduling boundary', async t => {
  const dir = await fixture(t);
  await run(dir, `
Object.defineProperty(process, 'platform', { value: 'linux' });
await fs.writeFile(path.join(core.home, 'credential'), 'fixture');
await core.save(path.join(core.home, 'config.json'), { ...c, concurrency: 1, paused: false, localOnly: false });
const request = 'paused-during-job-list';
globalThis.fetch = async url => {
  const endpoint = String(url).split('https://api.github.com')[1];
  if (endpoint === '/repos/owner/repo') return Response.json({ id: 1, private: true });
  if (endpoint.startsWith('/repos/owner/repo/actions/runners?')) return Response.json({ runners: [] });
  if (endpoint.includes('status=queued')) return Response.json({ workflow_runs: [{ id: 1, head_sha: '${'a'.repeat(40)}', head_branch: 'main', event: 'workflow_dispatch', pull_requests: [] }] });
  if (endpoint.includes('status=in_progress')) return Response.json({ workflow_runs: [] });
  if (endpoint.includes('/runs/1/jobs')) {
    await core.save(path.join(core.home, 'config.json'), { ...c, concurrency: 1, paused: true, pauseRequest: request, localOnly: false });
    process.emit('SIGTERM');
    return Response.json({ jobs: [{ id: 10, status: 'queued', labels: ['pool', 'starter-run-1', 'starter-source-${'a'.repeat(40)}'] }] });
  }
  assert.fail('Unexpected admission/network request: ' + endpoint);
};
const { serve } = await import(path.join(base, 'manager.ts'));
await serve();
const state = await core.readJson(path.join(core.home, 'status.json'));
assert.equal(state.error, undefined);
assert.equal(state.pauseRequest, request);
assert.equal(state.paused, true);
assert.deepEqual(state.active, []);
assert.equal(await core.exists(path.join(core.home, 'source.git')), false);
`);
});

test('authentication finishing after drain preserves pause, acknowledgement and current owned fields', async t => {
  const dir = await fixture(t);
  await run(dir, `
Object.defineProperty(process, 'platform', { value: 'linux' });
Object.defineProperty(process.stdin, 'isTTY', { value: true });
process.stdin.setRawMode = () => process.stdin;
process.stdin.resume = () => process.stdin;
process.stdin.pause = () => process.stdin;
globalThis.fetch = async () => Response.json({ private: true });
await core.save(path.join(core.home, 'config.json'), { ...c, concurrency: 1, paused: false, localOnly: true, tokenExpiry: 'old' });
await fs.mkdir(path.join(core.home, 'daemon.lock'));
const { main } = await import(path.join(base, 'cli.ts'));
const authenticating = main(['auth', 'replace']);
for (let n = 0; n < 100 && process.stdin.listenerCount('data') === 0; n++) await new Promise(resolve => setTimeout(resolve, 10));
assert(process.stdin.listenerCount('data') > 0);
const drain = main(['pause', '--drain']);
for (let n = 0; n < 100 && !(await core.config()).paused; n++) await new Promise(resolve => setTimeout(resolve, 10));
const paused = await core.config();
await core.save(path.join(core.home, 'status.json'), { pauseRequest: paused.pauseRequest, paused: true, active: [] });
await drain;
const { updateConfig } = await import(path.join(base, 'manager.ts'));
await updateConfig(async () => ({ tokenExpiry: 'newer' }));
await main(['config', 'set', 'cpus', '3']);
process.stdin.emit('data', Buffer.from('dummy-fixture-credential-123456789\\n'));
await authenticating;
const result = await core.config();
assert.equal(result.paused, true);
assert.equal(result.pauseRequest, paused.pauseRequest);
assert.equal(result.tokenExpiry, 'newer');
assert.equal(result.cpus, 3);
assert.equal(result.localOnly, false);
await updateConfig(async current => {
  assert.equal(current.paused, true);
  await assert.rejects(main(['resume']), /Another worker operation/);
  return { enabled: false };
});
assert.equal((await core.config()).paused, true);
`);
});

test('routing lookup failures preserve enabled state and confirmed absence or presence restores hosted routing', async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'gh'), `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const file = path.join(process.env.STARTER_WORKERS_HOME, 'gh.json');
const state = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2); state.calls.push(args);
fs.writeFileSync(file, JSON.stringify(state));
if (state.fail) { console.error('network/auth failed'); process.exit(1); }
if (args[1] === 'list') process.stdout.write(JSON.stringify(state.variables));
`, { mode: 0o755 });
  await run(dir, `
process.env.PATH = ${JSON.stringify(dir)} + ':' + process.env.PATH;
await core.save(path.join(core.home, 'config.json'), { ...c, enabled: true, paused: true, pauseRequest: 'ack' });
const { main } = await import(path.join(base, 'cli.ts'));
const { routingVariables } = await import(path.join(base, 'github.ts'));
await core.save(path.join(core.home, 'gh.json'), { calls: [], fail: true, variables: [] });
await assert.rejects(main(['hosted']), /failed/);
await assert.rejects(routingVariables(c), /failed/);
Object.defineProperty(process, 'platform', { value: 'linux' });
await fs.writeFile(path.join(core.home, 'credential'), 'dummy');
const { runtimePolicy } = await import(path.join(base, 'runtime.ts'));
const { proofId } = await import(path.join(base, 'proof.ts'));
const local = { sha: '${'a'.repeat(40)}', image: '${image}', runtime: core.hash(JSON.stringify(runtimePolicy(c))), pool: c.pool, key: 'key', scope: 'branch-test', checked: new Date().toISOString() };
const proof = { ...local, id: proofId(local) };
await core.save(path.join(core.home, 'local-check.json'), proof);
await core.save(path.join(core.home, 'github-check.json'), { ...proof, certified: local.checked });
await core.save(path.join(core.home, 'catalog.json'), { environments: [{ key: local.key, source: local.sha, image: local.image, scope: local.scope, used: local.checked }] });
await core.save(path.join(core.home, 'status.json'), { polled: local.checked, paused: false });
await assert.rejects(main(['enable']), /failed/);
assert.equal((await core.config()).enabled, true);
assert.equal((await core.readJson(path.join(core.home, 'gh.json'))).calls.some(a => a[1] !== 'list'), false);
for (const variables of [[], [{ name: 'PLATFORM_CI_WORKER_POOL', value: c.pool }]]) {
  await core.save(path.join(core.home, 'gh.json'), { calls: [], variables });
  await main(['hosted']);
  const current = await core.config();
  assert.equal(current.enabled, false); assert.equal(current.paused, true); assert.equal(current.pauseRequest, 'ack');
  const calls = (await core.readJson(path.join(core.home, 'gh.json'))).calls;
  assert.equal(calls.some(a => a[1] === 'delete'), variables.length > 0);
}
await core.save(path.join(core.home, 'gh.json'), { calls: [], variables: [{ name: 'PLATFORM_CI_WORKER_POOL', value: 'other' }] });
await assert.rejects(main(['hosted']), /Routing changed elsewhere/);
globalThis.fetch = async () => Response.json({ content: Buffer.from('starter-source-').toString('base64') });
await core.save(path.join(core.home, 'gh.json'), { calls: [], variables: [{ name: 'PLATFORM_CI_RUNNER', value: 'legacy' }] });
await assert.rejects(main(['enable']), /Remove legacy/);
await core.save(path.join(core.home, 'gh.json'), { calls: [], variables: [{ name: 'PLATFORM_CI_WORKER_POOL', value: 'previous' }] });
await main(['enable']);
assert.equal((await core.config()).enabled, true);
assert.equal((await core.config()).previousRouting, 'previous');
assert.equal((await core.config()).pauseRequest, 'ack');
await core.save(path.join(core.home, 'gh.json'), { calls: [], variables: [{ name: 'PLATFORM_CI_WORKER_POOL', value: c.pool }] });
await main(['hosted']);
assert.equal((await core.config()).enabled, false);
assert((await core.readJson(path.join(core.home, 'gh.json'))).calls.some(a => a[1] === 'set' && a.includes('previous')));
`);
});

test('GitHub launch requires immutable expected assignment before creating resources', async t => {
  const dir = await fixture(t);
  await run(dir, `
const { launch } = await import(path.join(base, 'runtime.ts'));
await assert.rejects(launch(c, '${image}', ['github'], 'dummy'), /expected assignment/);
assert.equal(await core.exists(path.join(core.home, 'docker.json')), false);
`);
});

test('GitHub launch copies expected identity with explicit root ownership and read-only mode', async t => {
  const dir = await fixture(t);
  await run(dir, `
const { launch } = await import(path.join(base, 'runtime.ts'));
const expected = { repository: c.repo, repositoryId: 7, runId: 123, runAttempt: 2, sha: '${'a'.repeat(40)}', event: 'push', ref: 'refs/heads/main' };
await launch(c, '${image}', ['github'], 'dummy', undefined, expected);
const state = await core.readJson(path.join(core.home, 'docker.json'));
assert.deepEqual(state.assignment, { uid: 0, gid: 0, mode: 0o444, expected });
const worker = Object.values(state.workers)[0];
assert(worker.env.includes('ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/starter/job-started.sh'));
`);
});
