import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './core.ts';
import { serviceWrapper } from './upgrade.ts';

const modules = path.dirname(fileURLToPath(import.meta.url));
const pool = (letter: string): string => `starter-${letter.repeat(32)}`;

async function scratch(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const parent = path.join(process.cwd(), '.ci-local-artifacts');
  await mkdir(parent, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(parent, 'worker-upgrade-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
/** Runs code in a child whose HOME (and so its service directory) is the scratch directory. */
async function run(directory: string, code: string, home = path.join(directory, 'unused')): Promise<string> {
  const script = path.join(directory, 'run.mjs');
  await writeFile(script, `import assert from 'node:assert/strict';\nimport * as fs from 'node:fs/promises';\nimport path from 'node:path';\nconst base = ${JSON.stringify(modules)};\nconst core = await import(path.join(base, 'core.ts'));\nconst upgrade = await import(path.join(base, 'upgrade.ts'));\n${code}`);
  return command(process.execPath, [script], { env: { ...process.env, HOME: directory, STARTER_WORKERS_HOME: home } });
}
async function checkout(directory: string, name: string, repo: string, starter = false): Promise<string> {
  const dir = path.join(directory, name);
  await mkdir(dir, { recursive: true });
  await command('git', ['init', '-q', dir]);
  await command('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${repo}.git`]);
  if (starter) { await mkdir(path.join(dir, 'platform/tooling/ci-workers'), { recursive: true }); await writeFile(path.join(dir, 'platform/tooling/ci-workers/cli.ts'), ''); }
  return dir;
}
/** A fake installation whose wrapper records each step and simulates the daemon lock. */
async function fake(directory: string, id: string, config: Record<string, unknown>, running: boolean): Promise<string> {
  const home = path.join(directory, `install-${id}`);
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ pool: pool(id), paused: false, ...config }));
  const wrapper = path.join(home, 'starter-workers');
  await writeFile(wrapper, `#!/bin/sh
h='${home}'
where=-; [ "$1" = check ] && where="$(pwd -P)"
echo "${id}|$where|$*" >> '${path.join(directory, 'calls.log')}'
case "$1 $2" in
  "service stop") rm -rf "$h/daemon.lock" ;;
  "service start") mkdir -p "$h/daemon.lock"; printf %s "$FAKE_OWNER" > "$h/daemon.lock/owner" ;;
  check*) if [ -e "$h/fail-check" ]; then echo "check broke" >&2; exit 1; fi ;;
esac
`, { mode: 0o755 });
  if (running) { await mkdir(path.join(home, 'daemon.lock')); await writeFile(path.join(home, 'daemon.lock/owner'), String(process.pid)); }
  const services = path.join(directory, process.platform === 'darwin' ? 'Library/LaunchAgents' : '.config/systemd/user');
  await mkdir(services, { recursive: true });
  await writeFile(path.join(services, `${pool(id)}.${process.platform === 'darwin' ? 'plist' : 'service'}`), process.platform === 'darwin'
    ? `<plist version="1.0"><dict><key>Label</key><string>${pool(id)}</string><key>ProgramArguments</key><array><string>${wrapper}</string><string>serve</string></array></dict></plist>`
    : `[Unit]\nDescription=Starter local workers\n[Service]\nExecStart="${wrapper}" serve\n`);
  return home;
}
const upgradeAll = (from: string, checkouts: Record<string, string>): string => `
process.env.FAKE_OWNER = String(process.pid);
const targets = await upgrade.installations();
try {
  const done = await upgrade.upgrade(targets, { from: ${JSON.stringify(from)}, checkouts: new Map(Object.entries(${JSON.stringify(checkouts)})), log: () => {}, stopTimeout: 5000, startTimeout: 5000 });
  process.stdout.write(JSON.stringify({ done }));
} catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); }`;
const calls = async (directory: string): Promise<string[]> => (await readFile(path.join(directory, 'calls.log'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);

test('service definitions written by install are discovered with their installation; broken ones are reported', async t => {
  const dir = await scratch(t);
  const home = path.join(dir, 'pool');
  await run(dir, `
const c = { pool: '${pool('a')}', repo: 'owner/repo', cpus: 2, memoryGiB: 4, diskGiB: 40, context: 'test', docker: '/usr/local/bin/docker', paused: true };
await core.save(path.join(core.home, 'config.json'), c);
const { install } = await import(path.join(base, 'service.ts'));
await install(c);`, home);
  const services = path.join(dir, process.platform === 'darwin' ? 'Library/LaunchAgents' : '.config/systemd/user');
  await writeFile(path.join(services, `${pool('b')}.${process.platform === 'darwin' ? 'plist' : 'service'}`), process.platform === 'darwin'
    ? `<plist><dict><key>ProgramArguments</key><array><string>${path.join(dir, 'gone/starter-workers')}</string></array></dict></plist>` : `[Service]\nExecStart="${path.join(dir, 'gone/starter-workers')}" serve\n`);
  const found = JSON.parse(await run(dir, 'process.stdout.write(JSON.stringify(await upgrade.installations()));'));
  assert.equal(found.length, 2);
  assert.deepEqual({ ...found[0], version: undefined }, {
    service: path.join(services, `${pool('a')}.${process.platform === 'darwin' ? 'plist' : 'service'}`), pool: pool('a'), home, wrapper: path.join(home, 'starter-workers'),
    repos: ['owner/repo'], org: false, running: false, paused: true, enabled: false, version: undefined,
  });
  assert.match(found[0].version, /^\d+-[0-9a-f]{8}$/);
  assert.match(found[1].error, /config\.json is missing/);
});

test('service wrappers are parsed from launchd and escaped systemd definitions', () => {
  assert.equal(serviceWrapper('<key>ProgramArguments</key><array><string>/Users/a &amp; b/ci/starter-workers</string><string>serve</string></array>'), '/Users/a & b/ci/starter-workers');
  assert.equal(serviceWrapper('[Service]\nExecStart="/home/u/my \\"ci\\" 100%%/starter-workers" serve\n'), '/home/u/my "ci" 100%/starter-workers');
  assert.equal(serviceWrapper('[Service]\nExecStart=/bin/true\n'), undefined);
});

test('upgrade drains, updates, checks in each app checkout and restores every manager to its earlier state', async t => {
  const dir = await scratch(t);
  const from = await checkout(dir, 'starter', 'acme/starter', true);
  const app = await checkout(dir, 'app', 'acme/app');
  const member = await checkout(dir, 'member', 'acme/member');
  await fake(dir, 'a', { repo: 'acme/app' }, true);
  await fake(dir, 'b', { repo: 'acme/member', org: 'acme', repos: ['acme/other', 'acme/member'], paused: true }, true);
  await fake(dir, 'c', { repo: 'acme/starter', updateRole: 'deliver' }, false);
  const result = JSON.parse(await run(dir, upgradeAll(from, { 'acme/app': app, 'acme/member': member })));
  assert.deepEqual(result.done, ['a', 'b', 'c'].map(id => path.join(dir, `install-${id}`)));
  assert.deepEqual(await calls(dir), [
    `a|-|pause --drain`, `a|-|service stop`, `a|-|update --from ${from}`, `a|${app}|check --install`, `a|-|service start`, `a|-|resume`,
    `b|-|pause --drain`, `b|-|service stop`, `b|-|update --from ${from}`, `b|${member}|check --install --repo acme/member`, `b|-|service start`,
    `c|-|update --from ${from}`, `c|${from}|check`,
  ], 'a paused manager stays paused, a stopped one stays stopped, delivery never installs app dependencies');
});

test('upgrade refuses before pausing anything when an install check has no checkout', async t => {
  const dir = await scratch(t);
  const from = await checkout(dir, 'starter', 'acme/starter', true);
  const app = await checkout(dir, 'app', 'acme/app');
  await fake(dir, 'a', { repo: 'acme/app' }, true);
  await fake(dir, 'b', { repo: 'acme/missing' }, true);
  assert.match(JSON.parse(await run(dir, upgradeAll(from, { 'acme/app': app }))).error, /serves acme\/missing; pass --checkout acme\/missing=PATH/);
  assert.match(JSON.parse(await run(dir, upgradeAll(from, { 'acme/app': app, 'acme/missing': app }))).error, /is not a checkout of acme\/missing/);
  assert.deepEqual(await calls(dir), []);
});

test('a dry run plans every installation without running any step', async t => {
  const dir = await scratch(t);
  const from = await checkout(dir, 'starter', 'acme/starter', true);
  const app = await checkout(dir, 'app', 'acme/app');
  await fake(dir, 'a', { repo: 'acme/app' }, true);
  const output = await run(dir, `
const lines = [];
const targets = await upgrade.installations();
const done = await upgrade.upgrade(targets, { from: ${JSON.stringify(from)}, checkouts: new Map([['acme/app', ${JSON.stringify(app)}]]), log: line => lines.push(line), dryRun: true });
process.stdout.write(JSON.stringify({ done, lines }));`);
  assert.deepEqual(JSON.parse(output), { done: [], lines: [`Plan: ${path.join(dir, 'install-a')} (acme/app; running), install check in ${app}`] });
  assert.deepEqual(await calls(dir), []);
});

test('a failed install check rolls back, restarts that manager and leaves later installations untouched', async t => {
  const dir = await scratch(t);
  const from = await checkout(dir, 'starter', 'acme/starter', true);
  const app = await checkout(dir, 'app', 'acme/app');
  const home = await fake(dir, 'a', { repo: 'acme/app' }, true);
  await fake(dir, 'b', { repo: 'acme/app' }, true);
  await writeFile(path.join(home, 'fail-check'), '');
  const { error } = JSON.parse(await run(dir, upgradeAll(from, { 'acme/app': app })));
  assert.match(error, /install check of the new version \(rolled back to the previous installation\) failed; the manager was restarted/);
  assert.match(error, new RegExp(`Not attempted: ${path.join(dir, 'install-b')}`));
  assert.deepEqual(await calls(dir), [
    `a|-|pause --drain`, `a|-|service stop`, `a|-|update --from ${from}`, `a|${app}|check --install`, `a|-|rollback`, `a|-|service start`, `a|-|resume`,
  ]);
});

test('rollback restores the previous installation and refuses while the manager runs', async t => {
  const dir = await scratch(t);
  const home = path.join(dir, 'pool');
  await run(dir, `
const c = { pool: '${pool('a')}', repo: 'owner/repo', cpus: 2, memoryGiB: 4, diskGiB: 40, context: 'test', docker: '/usr/local/bin/docker' };
await core.save(path.join(core.home, 'config.json'), c);
const { install, installationComplete, rollback } = await import(path.join(base, 'service.ts'));
await install(c);
const first = await fs.readlink(path.join(core.home, 'current'));
await new Promise(resolve => setTimeout(resolve, 5));
await install(c);
const second = await fs.readlink(path.join(core.home, 'current'));
assert.notEqual(first, second);
assert.equal(await rollback(), first);
assert.equal(await fs.readlink(path.join(core.home, 'current')), first);
assert.equal(await fs.readlink(path.join(core.home, 'previous')), second);
assert.equal(await installationComplete(c.pool), true);
await fs.mkdir(path.join(core.home, 'daemon.lock'));
await fs.writeFile(path.join(core.home, 'daemon.lock', 'owner'), String(process.pid));
await assert.rejects(rollback(), /Stop the manager before rolling back/);`, home);
});
