import path from 'node:path';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { assert, command, configuredRepos, exists, readJson, repository, type Config } from './core.ts';
import { lockHeld } from './manager.ts';
import { serviceDefinition } from './service.ts';

/** One installed manager, found through its launchd/systemd service definition. */
export interface Installation {
  service: string; pool: string; home: string; wrapper: string;
  repos: string[]; org: boolean; role?: string;
  running: boolean; paused: boolean; enabled: boolean; version?: string;
  error?: string;
}
export interface UpgradeOptions {
  /** Checkout whose platform/tooling/ci-workers becomes the installed manager. */
  from: string;
  /** Lowercase owner/name → local checkout used for the install check. */
  checkouts: Map<string, string>;
  log: (line: string) => void;
  stopTimeout?: number; startTimeout?: number;
  /** Print the plan after preflight and change nothing. */
  dryRun?: boolean;
}
interface Plan { target: Installation; checkout: string; check: string[] }

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const unxml =(s: string): string => s.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
/** The installation wrapper a service definition runs (install() writes both formats). */
export function serviceWrapper(definition: string): string | undefined {
  const plist = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(definition);
  if (plist) return unxml(plist[1]);
  const unit = /^ExecStart="((?:[^"\\]|\\.)*)"/m.exec(definition);
  return unit?.[1].replaceAll('%%', '%').replace(/\\(.)/g, '$1');
}

export async function installations(): Promise<Installation[]> {
  const directory = path.dirname(serviceDefinition('starter-'));
  const files = (await readdir(directory).catch(() => [] as string[])).filter(file => /^starter-[0-9a-f]{32}\.(plist|service)$/.test(file)).sort();
  const found: Installation[] = [];
  for (const file of files) {
    const service = path.join(directory, file);
    const pool = file.replace(/\.(plist|service)$/, '');
    const blank = { service, pool, home: '', wrapper: '', repos: [], org: false, running: false, paused: false, enabled: false };
    const wrapper = serviceWrapper(await readFile(service, 'utf8'));
    if (!wrapper) { found.push({ ...blank, error: 'service definition names no starter-workers command' }); continue; }
    const home = path.dirname(wrapper);
    const c = await readJson<Partial<Config>>(path.join(home, 'config.json'), {});
    if (c.pool !== pool || !c.repo) { found.push({ ...blank, home, wrapper, error: c.pool ? `${home}/config.json belongs to ${c.pool}` : `${home}/config.json is missing` }); continue; }
    if (!await exists(wrapper)) { found.push({ ...blank, home, wrapper, error: `${wrapper} is missing` }); continue; }
    found.push({
      service, pool, home, wrapper, repos: configuredRepos(c as Config), org: Boolean(c.org), role: c.updateRole,
      running: await lockHeld('daemon', home), paused: c.paused === true,
      enabled: c.org ? Object.values(c.routing ?? {}).some(value => value.enabled) : c.enabled === true,
      version: path.basename(await readlink(path.join(home, 'current')).catch(() => '')) || undefined,
    });
  }
  return found;
}

async function origin(checkout: string): Promise<string> {
  return repository(await command('git', ['-C', checkout, 'remote', 'get-url', 'origin'])).toLowerCase();
}
/** Resolve every target's check checkout before any manager is paused. */
export async function planUpgrade(targets: Installation[], options: UpgradeOptions): Promise<Plan[]> {
  assert(await exists(path.join(options.from, 'platform/tooling/ci-workers/cli.ts')), `--from must be a checkout containing platform/tooling/ci-workers/cli.ts: ${options.from}`);
  const fromRepo = await origin(options.from).catch(() => '');
  const plans: Plan[] = [];
  for (const target of targets) {
    assert(!target.error, `${target.service}: ${target.error}. Repair or uninstall it, or upgrade the others without --all`);
    const repo = target.repos.find(name => options.checkouts.has(name.toLowerCase())) ?? target.repos.find(name => name.toLowerCase() === fromRepo);
    assert(repo, `${target.home} serves ${target.repos.join(', ')}; pass --checkout ${target.repos[0]}=PATH to a local checkout for its install check`);
    const checkout = options.checkouts.get(repo.toLowerCase()) ?? options.from;
    assert(await origin(checkout).catch(() => '') === repo.toLowerCase(), `${checkout} is not a checkout of ${repo}`);
    plans.push({ target, checkout, check: ['check', ...(target.role === 'deliver' ? [] : ['--install']), ...(target.org ? ['--repo', repo] : [])] });
  }
  return plans;
}

async function waitFor(home: string, held: boolean, timeout: number, message: string): Promise<void> {
  for (const deadline = Date.now() + timeout; await lockHeld('daemon', home) !== held;) {
    assert(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
/**
 * The documented manual sequence, run through the installation's own wrapper so each step uses the
 * code that matches the running manager. Paused or stopped managers keep that state.
 */
async function upgradeOne(plan: Plan, options: UpgradeOptions): Promise<void> {
  const { target } = plan;
  const step = async (args: string[], cwd?: string, timeout = 3 * 3600_000): Promise<void> => {
    options.log(`${target.home}: starter-workers ${args.join(' ')}${cwd ? ` (in ${cwd})` : ''}`);
    await command(target.wrapper, args, { cwd, stream: true, timeout });
  };
  const start = async (): Promise<void> => {
    if (!target.running) return;
    if (!await lockHeld('daemon', target.home)) {
      await step(['service', 'start']);
      await waitFor(target.home, true, options.startTimeout ?? 60_000, `${target.home}: the manager did not start; inspect its logs`);
    }
    if (!target.paused) await step(['resume']);
  };
  const restore = async (error: unknown, what: string): Promise<never> => {
    const restarted = await start().then(() => target.running, (failure: unknown) => { options.log(`${target.home}: restart failed: ${String(failure)}`); return false; });
    throw new Error(`${target.home}: ${what} failed${restarted ? '; the manager was restarted' : ''}: ${message(error)}`, { cause: error });
  };
  if (target.running) {
    await step(['pause', '--drain'], undefined, 8 * 3600_000).catch(error => restore(error, 'drain'));
    await step(['service', 'stop']).catch(error => restore(error, 'service stop'));
    await waitFor(target.home, false, options.stopTimeout ?? 600_000, 'the manager did not exit after service stop').catch(error => restore(error, 'stop'));
  }
  await step(['update', '--from', options.from]).catch(error => restore(error, 'update'));
  try { await step(plan.check, plan.checkout); }
  catch (error) {
    await step(['rollback']).catch(failure => restore(failure, `install check failed (${message(error)}), then rollback`));
    await restore(error, 'install check of the new version (rolled back to the previous installation)');
  }
  await start();
}

export async function upgrade(targets: Installation[], options: UpgradeOptions): Promise<string[]> {
  assert(targets.length > 0, 'No installed manager services found');
  const plans = await planUpgrade(targets, options);
  for (const plan of plans) options.log(`Plan: ${plan.target.home} (${plan.target.repos.join(', ')}; ${plan.target.running ? plan.target.paused ? 'running, paused' : 'running' : 'stopped'}), install check in ${plan.checkout}`);
  if (options.dryRun) return [];
  const done: string[] = [];
  for (const plan of plans) {
    try { await upgradeOne(plan, options); }
    catch (error) { throw new Error(`${message(error)}${done.length ? `\nAlready upgraded: ${done.join(', ')}` : ''}\nNot attempted: ${plans.slice(plans.indexOf(plan) + 1).map(p => p.target.home).join(', ') || 'none'}`, { cause: error }); }
    done.push(plan.target.home);
  }
  return done;
}
