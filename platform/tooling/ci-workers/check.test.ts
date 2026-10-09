import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SEAM_HOOKS, checkZone } from '../check-zone.ts';
import { ensureBaseline } from './baseline.ts';
import { sourceCheck } from './check.ts';
import { command } from './core.ts';

const modules = path.dirname(fileURLToPath(import.meta.url));
const repo = 'reviewed/platform-source';
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'worker-archive-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const upstream = path.join(dir, 'upstream'), root = path.join(dir, 'archive');
  await mkdir(upstream); await mkdir(root);
  const config = path.join(dir, 'gitconfig');
  // Disposable repositories need no maintenance process that can outlive a command and race cleanup.
  await writeFile(config, `[maintenance]\n\tauto = false\n[url "file://${upstream}"]\n\tinsteadOf = https://github.com/${repo}.git\n`);
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd: string, ...args: string[]) => command('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=test', '-c', 'user.email=test@localhost', ...args], { cwd, env: gitEnv });
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(path.join(upstream, file)), { recursive: true });
    await writeFile(path.join(upstream, file), text);
  };
  await git(upstream, 'init', '--quiet');
  await write('apps/web/page.ts', 'export const page = 1;\n');
  await git(upstream, 'add', '--all'); await git(upstream, 'commit', '--quiet', '-m', 'ancestor');
  const parent = await git(upstream, 'rev-parse', 'HEAD');
  const seams = new Map<string, string[]>();
  for (const { file, hook } of SEAM_HOOKS) seams.set(file, [...(seams.get(file) ?? []), hook]);
  for (const [file, hooks] of seams) await write(file, hooks.join('\n') + '\n');
  await write('platform/VERSION', '4.1.0\n');
  await git(upstream, 'add', '--all'); await git(upstream, 'commit', '--quiet', '-m', 'release');
  const baseline = await git(upstream, 'rev-parse', 'HEAD');
  await git(upstream, 'tag', 'v4.1.0');
  await write('.platform-base.json', JSON.stringify({ version: '4.1.0', commit: baseline, patches: [] }));
  await write('apps/web/page.ts', 'export const page = 2;\n');
  await git(upstream, 'add', '--all'); await git(upstream, 'commit', '--quiet', '-m', 'adopt');
  const source = await git(upstream, 'rev-parse', 'HEAD');
  const archive = path.join(dir, 'source.tar');
  await git(upstream, 'archive', '--format=tar', '-o', archive, source);
  await command('tar', ['-xf', archive, '-C', root]);
  const bin = path.join(dir, 'bin'); await mkdir(bin);
  const calls = path.join(dir, 'bun-calls.jsonl');
  // Replace the expensive application CI boundary, but execute the real zone consumer.
  await writeFile(path.join(bin, 'bun'), `#!${process.execPath}\nimport fs from 'node:fs';\nimport { checkZone } from ${JSON.stringify(new URL('../check-zone.ts', import.meta.url).href)};\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.CHECK_CALLS, JSON.stringify(args) + '\\n');\nif (args[0] === 'run') { const result = checkZone(process.cwd()); if (result.errors.length) { console.error(result.errors.join('\\n')); process.exit(1); } }\n`, { mode: 0o755 });
  const env = { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, CHECK_CALLS: calls, GIT_ALLOW_PROTOCOL: 'file' };
  const run = (mode: 'ci' | 'quick' | 'install', repository = repo) => {
    const argv = sourceCheck(mode, repository, path.join(modules, 'baseline.ts'));
    return command(argv[1], argv.slice(2), { cwd: root, env });
  };
  const invocations = async () => (await readFile(calls, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]);
  return { root, upstream, baseline, parent, source, git, run, invocations, env };
}

for (const mode of ['ci', 'quick'] as const) test(`archive ${mode} fetches only the missing baseline and preserves source and zone enforcement`, async t => {
  const f = await fixture(t);
  assert.match(checkZone(f.root).errors.join('\n'), /is not in this clone/);
  // The former local-check command reaches CI with no baseline and fails as reported in #322.
  await assert.rejects(command('/bin/bash', ['-c', 'bun install --offline --frozen-lockfile && bun run ci'], { cwd: f.root, env: f.env }), /is not in this clone/);
  await f.run(mode);
  assert.deepEqual(checkZone(f.root).errors, []);
  await f.git(f.root, 'cat-file', '-e', `${f.baseline}^{commit}`);
  await assert.rejects(f.git(f.root, 'cat-file', '-e', `${f.parent}^{commit}`));
  await assert.rejects(f.git(f.root, 'cat-file', '-e', `${f.source}^{commit}`));
  assert.equal(await f.git(f.root, 'tag', '--list'), '');
  assert.equal(await f.git(f.root, 'status', '--porcelain'), '');
  assert.equal(await readFile(path.join(f.root, 'apps/web/page.ts'), 'utf8'), 'export const page = 2;\n');
  const head = await f.git(f.root, 'rev-parse', 'HEAD');
  // An existing baseline needs no reachable source: the protocol policy forbids HTTPS.
  await command(process.execPath, [path.join(modules, 'baseline.ts')], { cwd: f.root, env: { ...f.env, PLATFORM_SOURCE_REPOSITORY: 'unreachable/source' } });
  assert.equal(await f.git(f.root, 'rev-parse', 'HEAD'), head);
  const calls = await f.invocations();
  assert.deepEqual(calls.slice(-2), [['install', '--offline', '--frozen-lockfile'], ['run', mode === 'ci' ? 'ci' : 'ci:quick']]);
  await writeFile(path.join(f.root, 'platform/VERSION'), 'unrecorded edit\n');
  assert.match(checkZone(f.root).errors.join('\n'), /platform-zone edit is not a recorded patch/);
});

test('archive install-only remains offline and does not initialize Git or fetch a baseline', async t => {
  const f = await fixture(t);
  await f.run('install');
  assert.deepEqual(await f.invocations(), [['install', '--offline', '--frozen-lockfile']]);
  await assert.rejects(readFile(path.join(f.root, '.git/HEAD')));
});

test('product archives need no platform source network access', async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, '.platform-base.json'));
  await f.run('ci', 'unreachable/source');
  assert.deepEqual(checkZone(f.root).errors, []);
});

for (const value of ['{', 'null', '[]', '{}', '{"commit":"--upload-pack=evil"}', '{"commit":"abcdef1"}', JSON.stringify({ commit: 'f'.repeat(40) })]) {
  test(`invalid or unavailable baseline stops archive CI: ${value}`, async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.root, '.platform-base.json'), value);
    await assert.rejects(f.run('ci'));
    assert.deepEqual(await f.invocations(), []);
  });
}

test('an object that is not a commit cannot satisfy the baseline', async t => {
  const f = await fixture(t);
  const blob = await f.git(f.upstream, 'rev-parse', 'HEAD:platform/VERSION');
  await writeFile(path.join(f.root, '.platform-base.json'), JSON.stringify({ commit: blob }));
  await assert.rejects(f.run('ci'));
  assert.deepEqual(await f.invocations(), []);
});

test('source repository validation rejects URLs, traversal and shell payloads before fetching', async t => {
  const f = await fixture(t);
  for (const invalid of ['https://github.com/owner/repo', '../repo', 'owner/..', 'owner/repo;touch x', 'owner/repo/extra']) {
    assert.throws(() => sourceCheck('ci', invalid), /Invalid GitHub/);
    await assert.rejects(ensureBaseline(f.root, invalid), /Invalid GitHub/);
  }
  assert.deepEqual(await f.invocations(), []);
});

test('a source fetch failure stops CI without an alternate repository or broad history fetch', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run('ci', 'unreachable/source'), /transport 'https' not allowed/);
  assert.deepEqual(await f.invocations(), []);
  await assert.rejects(f.git(f.root, 'cat-file', '-e', `${f.baseline}^{commit}`));
});
