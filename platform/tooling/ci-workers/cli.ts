import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { assert, catalog, command, config, docker, exists, hash, home, installationPool, readJson, repository, save, validateRepo, type Config } from './core.ts';
import { api, routingVariables, storeToken, token } from './github.ts';
import { prepare } from './images.ts';
import { cleanup, lock, serve, status, updateConfig } from './manager.ts';
import { launch, runtimePolicy } from './runtime.ts';
import { localProof, proofId, certify, type Proof } from './proof.ts';
import { install, removeConvenienceCommand, service } from './service.ts';

const print = (v: unknown): void => { process.stdout.write(typeof v === 'string' ? v + '\n' : JSON.stringify(v, null, 2) + '\n'); };
function option(args: string[], name: string): string | undefined { const i = args.indexOf(`--${name}`); if (i < 0) return; assert(args[i + 1] && !args[i + 1].startsWith('--'), `--${name} requires a value`); return args[i + 1]; }
async function hiddenToken(): Promise<string> {
  assert(process.stdin.isTTY, 'Run auth/setup interactively: the token is read from a hidden terminal prompt');
  process.stderr.write('Dedicated fine-grained manager token (hidden): ');
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (data: Buffer): void => {
      for (const character of data.toString()) {
        if (character === '\r' || character === '\n' || character === '\x03') {
          process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n');
          if (character === '\x03') reject(new Error('Cancelled')); else resolve(value);
          return;
        }
        if (character === '\x7f') value = value.slice(0, -1); else value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function authenticate(c: Config, expiry?: string): Promise<Config> {
  const credential = await hiddenToken();
  const repo = await api<{ private: boolean }>(`/repos/${c.repo}`, credential);
  assert(repo.private || c.publicBranch, 'Normal local workers require a private repository. Use --public-branch only for a manually dispatched reviewed diagnostic branch.');
  await api(`/repos/${c.repo}/actions/runners?per_page=1`, credential);
  await api(`/repos/${c.repo}/actions/runs?per_page=1`, credential);
  await api(`/repos/${c.repo}/contents/package.json`, credential);
  await api(`/repos/${c.repo}/pulls?per_page=1`, credential);
  return updateConfig(async current => {
    assert(current.repo === c.repo && current.pool === c.pool, 'Installation changed during authentication');
    await storeToken(credential);
    return { localOnly: false, ...(expiry !== undefined ? { tokenExpiry: expiry } : {}) };
  });
}
async function setup(args: string[]): Promise<void> {
  if (await exists(path.join(home, 'config.json'))) {
    let existing = await config();
    assert(!await exists(path.join(home, 'daemon.lock')), 'Manager is already running; use check or update');
    if (existing.localOnly && !args.includes('--local-only')) existing = await authenticate(existing, option(args, 'token-expires'));
    await localCheck(existing, ['check', '--install']);
    print(await install(existing));
    if (!existing.localOnly) await service(existing, true);
    print('Setup resumed successfully; GitHub routing is unchanged.'); return;
  }
  const root = await command('git', ['rev-parse', '--show-toplevel']);
  const repo = option(args, 'repo') ? validateRepo(option(args, 'repo')!) : repository(await command('git', ['-C', root, 'remote', 'get-url', 'origin']));
  const dockerPath = await command('which', ['docker']);
  const context = await command(dockerPath, ['context', 'show']);
  const contexts = JSON.parse(await command(dockerPath, ['context', 'inspect', context])) as { Endpoints: { docker: { Host: string } } }[];
  assert(contexts[0].Endpoints.docker.Host.startsWith('unix://'), 'Use a local Unix-socket Docker context');
  const info = JSON.parse(await command(dockerPath, ['info', '--format', '{{json .}}'])) as { OSType: string; MemTotal: number; NCPU: number };
  assert(info.OSType === 'linux' && info.MemTotal >= 6 * 1024 ** 3, 'Docker needs Linux containers and at least 6 GiB memory');
  await mkdir(home, { recursive: true, mode: 0o700 }); await chmod(home, 0o700);
  const fs = await statfs(home);
  assert(fs.bavail * fs.bsize > 12 * 1024 ** 3, 'At least 12 GiB free disk is required for initial preparation');
  let c: Config = { version: 1, repo, pool: installationPool(), docker: dockerPath, context,
    concurrency: 1, cpus: Math.min(4, info.NCPU), memoryGiB: Math.min(8, Math.floor(info.MemTotal / 1024 ** 3) - 2), diskGiB: 40,
    paused: false, localOnly: true, publicBranch: option(args, 'public-branch'), tokenExpiry: option(args, 'token-expires'), installedAt: new Date().toISOString() };
  await lock('configuration', async () => {
    assert(!await exists(path.join(home, 'config.json')), 'Another setup created this installation');
    await save(path.join(home, 'config.json'), c);
  });
  if (!args.includes('--local-only')) c = await authenticate(c);
  const wrapper = await install(c);
  print(`Repository: ${repo}\nInstalled: ${wrapper}\nAdd ${path.dirname(wrapper)} to PATH. Docker context: ${context}.\nPreparing the committed revision; uncommitted files are not included.`);
  const sha = await command('git', ['-C', root, 'rev-parse', 'HEAD']);
  const branch = await command('git', ['-C', root, 'branch', '--show-current']);
  await lock('mutation', () => prepare(c, root, sha, `branch-${hash(branch).slice(0, 16)}`));
  if (!c.localOnly) await service(c, true);
  print('Ready. Normal GitHub routing is unchanged. Run starter-workers check, then check --github before enable.');
}
async function localCheck(c: Config, args: string[]): Promise<void> {
  const root = await command('git', ['rev-parse', '--show-toplevel']);
  const sha = await command('git', ['-C', root, 'rev-parse', `${option(args, 'ref') ?? 'HEAD'}^{commit}`]);
  const branch = option(args, 'ref') ?? await command('git', ['-C', root, 'branch', '--show-current']);
  const env = await lock('mutation', () => prepare(c, root, sha, `branch-${hash(branch).slice(0, 16)}`, args.includes('--refresh')));
  for (let n = 0; n < 2; n++) print(await launch(c, env.image, ['smoke']));
  if (args.includes('--ci') || args.includes('--quick') || args.includes('--install')) {
    const archive = path.join(home, `source-${sha}.tar`);
    await command('git', ['-C', root, 'archive', '--format=tar', '-o', archive, sha]);
    try {
      const script = 'tar --no-same-owner -xf /work/source.tar -C /work && rm /work/source.tar && bun install --offline --frozen-lockfile' + (args.includes('--ci') ? ' && bun run ci' : args.includes('--quick') ? ' && bun run ci:quick' : '');
      print(await launch(c, env.image, ['exec', '/bin/bash', '-c', script], undefined, async name => { await docker(c, ['cp', archive, `${name}:/work/source.tar`]); }));
    } finally { await rm(archive, { force: true }); }
  }
  const proof = { sha, image: env.image, runtime: hash(JSON.stringify(runtimePolicy(c))), key: env.key, scope: env.scope, pool: c.pool, checked: new Date().toISOString() };
  await save(path.join(home, 'local-check.json'), { ...proof, id: proofId(proof) });
}
async function githubCheck(c: Config, args: string[]): Promise<void> {
  assert(!c.localOnly, 'Run starter-workers auth replace and service start first');
  const proof = await localProof(c);
  const runId = option(args, 'run');
  if (runId) {
    assert(/^\d+$/.test(runId), 'Invalid run ID');
    const credential = await token();
    const run = await api<{ display_title: string; event: string; path: string; status: string; conclusion: string; head_sha: string; html_url: string }>(`/repos/${c.repo}/actions/runs/${runId}`, credential);
    assert(run.event === 'workflow_dispatch' && run.path === '.github/workflows/ci-verify.yml' && run.status === 'completed' && run.conclusion === 'success', 'Diagnostic must be a successful completed CI Verify Commit dispatch');
    certify(proof, run);
    const jobs = await api<{ jobs: { name: string; conclusion: string; labels: string[] }[] }>(`/repos/${c.repo}/actions/runs/${runId}/jobs?per_page=100`, credential);
    for (const name of ['Worker isolation 1', 'Worker isolation 2']) {
      assert(jobs.jobs.some(j => j.name === name && j.conclusion === 'success' && j.labels.includes(c.pool) && j.labels.includes(`starter-source-${run.head_sha}`) && j.labels.includes(`starter-run-${runId}`)), 'Both disposable worker jobs must pass in this pool');
    }
    await save(path.join(home, 'github-check.json'), { ...proof, certified: new Date().toISOString(), url: run.html_url, runId });
    print(`GitHub worker isolation check passed: ${run.html_url}`); return;
  }
  const ref = option(args, 'ref') ?? c.publicBranch ?? (await api<{ default_branch: string }>(`/repos/${c.repo}`, await token())).default_branch;
  const commit = await api<{ sha: string }>(`/repos/${c.repo}/commits/${encodeURIComponent(ref)}`, await token());
  assert(commit.sha === proof.sha && `branch-${hash(ref).slice(0, 16)}` === proof.scope, 'Dispatch branch must match the local proof');
  // ci-verify.yml already exists on the default branch, so dispatching its branch version works before merge.
  await command('gh', ['workflow', 'run', 'ci-verify.yml', '--repo', c.repo, '--ref', ref, '-f', 'worker_check=true', '-f', `worker_pool=${c.pool}`, ...Object.entries({ worker_sha: proof.sha, worker_image: proof.image, worker_runtime: proof.runtime, worker_proof: proof.id, worker_checked: proof.checked }).flatMap(([key, value]) => ['-f', `${key}=${value}`])]);
  print(`Dispatched CI Verify Commit worker check on ${ref}. Use gh run list --repo ${c.repo} --workflow ci-verify.yml, then gh run watch RUN_ID --repo ${c.repo} --exit-status. Routing is unchanged.`);
}
export async function main(args: string[]): Promise<void> {
  const verb = args[0] ?? 'help';
  if (verb === 'help' || args.includes('--help')) {
    print('starter-workers setup [--local-only] [--repo owner/name] [--public-branch branch] [--token-expires YYYY-MM-DD]\ncheck [--ref revision] [--install|--quick|--ci] | check --github [--ref branch]\nserve | service start|stop | status [--watch] | logs [--follow] | images\nauth replace | enable | hosted | pause [--drain] | resume | refresh\ncleanup [--dry-run] | config set concurrency|memoryGiB|cpus|diskGiB NUMBER\nupdate --from CHECKOUT | uninstall\nOne repository per STARTER_WORKERS_HOME. All builds stay in the local Docker engine.'); return;
  }
  if (verb === 'setup') return setup(args);
  let c = await config();
  switch (verb) {
    case 'serve': return serve();
    case 'service': assert(['start', 'stop'].includes(args[1]), 'Use service start|stop'); return service(c, args[1] === 'start');
    case 'auth': assert(args[1] === 'replace', 'Use auth replace'); await authenticate(c, option(args, 'token-expires')); return;
    case 'check': return args.includes('--github') ? githubCheck(c, args) : localCheck(c, args);
    case 'refresh': return localCheck(c, [...args, '--refresh', '--install']);
    case 'status': do { print(await status()); if (!args.includes('--watch')) break; await new Promise(resolve => setTimeout(resolve, 5000)); } while (args.includes('--watch')); return;
    case 'images': print((await catalog()).environments); return;
    case 'logs': if (process.platform === 'linux') { print(await command('journalctl', ['--user', '-u', `${c.pool}.service`, '-n', '100', ...(args.includes('--follow') ? ['-f'] : [])], { stream: args.includes('--follow'), timeout: args.includes('--follow') ? 86400_000 : 10_000 })); return; } print(await command('tail', ['-n', '100', ...(args.includes('--follow') ? ['-f'] : []), path.join(home, 'logs/manager.log')], { stream: args.includes('--follow'), timeout: args.includes('--follow') ? 86400_000 : 10_000 })); return;
    case 'cleanup': print(await lock('mutation', () => cleanup(c, args.includes('--dry-run')))); return;
    case 'pause': case 'resume':
      assert(!args.includes('--drain') || verb === 'pause', '--drain requires pause');
      c = await updateConfig(async () => ({ paused: verb === 'pause', pauseRequest: randomUUID() }));
      if (args.includes('--drain')) {
        for (;;) {
          const heartbeat = await readJson<{ pauseRequest?: string; paused?: boolean; active?: number[]; error?: string }>(path.join(home, 'status.json'), {});
          if (heartbeat.pauseRequest === c.pauseRequest && heartbeat.paused && !heartbeat.error && heartbeat.active?.length === 0) break;
          assert(await exists(path.join(home, 'daemon.lock')), 'Start the manager to acknowledge and drain the pause');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      print(c.paused ? 'Paused. Queued jobs wait until resume or hosted routing.' : 'Resumed.'); return;
    case 'config': {
      const key = args[2]; const value = Number(args[3]);
      assert(args[1] === 'set' && ['concurrency', 'memoryGiB', 'cpus', 'diskGiB'].includes(key) && Number.isInteger(value) && value >= 1 && value <= 512, 'Use config set concurrency|memoryGiB|cpus|diskGiB NUMBER');
      await updateConfig(async current => {
        const next = { ...current, [key]: value };
        const engine = JSON.parse(await docker(next, ['info', '--format', '{{json .}}'])) as { MemTotal: number; NCPU: number };
        assert(next.concurrency * next.memoryGiB + 1 <= engine.MemTotal / 1024 ** 3 && next.concurrency * next.cpus <= engine.NCPU && next.diskGiB >= 12, 'Configured workers exceed Docker CPU/memory capacity, or disk budget is below 12 GiB');
        return { [key]: value };
      }); return;
    }
    case 'enable': {
      await updateConfig(async c => {
        assert(!c.publicBranch && !c.localOnly, 'Normal routing requires a private repository and active manager');
        const local = await localProof(c);
        const proof = await readJson<Proof & { certified: string }>(path.join(home, 'github-check.json'));
        assert(proof.id === local.id && proof.sha === local.sha && proof.image === local.image && proof.runtime === local.runtime && Date.now() - Date.parse(proof.certified) >= 0 && Date.now() - Date.parse(proof.certified) < 86400_000, 'A current matching GitHub certification is required');
        const state = await readJson<{ polled: string; error?: string; paused?: boolean }>(path.join(home, 'status.json'), { polled: '' });
        assert(Date.now() - Date.parse(state.polled) < 60_000 && !state.error && !state.paused, 'Manager must be healthy and accepting work before enabling');
        const routing = await routingVariables(c);
        const legacy = routing.get('PLATFORM_CI_RUNNER');
        assert(!legacy, 'Remove legacy PLATFORM_CI_RUNNER routing before enabling managed workers');
        const workflow = await api<{ content: string }>(`/repos/${c.repo}/contents/.github/workflows/platform-ci-web.yml`, await token());
        assert(Buffer.from(workflow.content, 'base64').toString().includes('starter-source-'), 'Adopt supporting workflows on the default branch before enabling');
        const previous = routing.get('PLATFORM_CI_WORKER_POOL') ?? '';
        await command('gh', ['variable', 'set', 'PLATFORM_CI_WORKER_POOL', '--repo', c.repo, '--body', c.pool]);
        return { enabled: true, ...(!c.enabled ? { previousRouting: previous } : {}) };
      }); return;
    }
    case 'hosted': {
      await updateConfig(async c => {
        const current = (await routingVariables(c)).get('PLATFORM_CI_WORKER_POOL');
        assert(!current || current === c.pool, 'Routing changed elsewhere; refusing to overwrite it');
        if (c.previousRouting) await command('gh', ['variable', 'set', 'PLATFORM_CI_WORKER_POOL', '--repo', c.repo, '--body', c.previousRouting]);
        else if (current) await command('gh', ['variable', 'delete', 'PLATFORM_CI_WORKER_POOL', '--repo', c.repo]);
        return { enabled: false };
      });
      print('Routing restored for new runs. Existing queued jobs retain their labels: cancel and start fresh runs if needed.'); return;
    }
    case 'update': {
      const root = path.resolve(option(args, 'from') ?? '.');
      assert(!await exists(path.join(home, 'daemon.lock')), 'Pause --drain and service stop before updating');
      await command(process.execPath, [path.join(root, 'platform/tooling/ci-workers/cli.ts'), 'install-update', '--from', root], { timeout: 2 * 3600_000 });
      print('Manager updated. Run check before service start; previous installation remains in ~/.local/share/starter-workers/previous.'); return;
    }
    case 'install-update': {
      const root = path.resolve(option(args, 'from') ?? '.');
      const sha = await command('git', ['-C', root, 'rev-parse', 'HEAD']);
      const branch = await command('git', ['-C', root, 'branch', '--show-current']);
      await lock('mutation', () => prepare(c, root, sha, `branch-${hash(branch).slice(0, 16)}`));
      await install(c); return;
    }
    case 'uninstall':
      assert(!c.enabled && !await exists(path.join(home, 'daemon.lock')), 'Run hosted, pause --drain, then service stop first');
      if (process.platform === 'darwin') {
        await command('/usr/bin/security', ['delete-generic-password', '-a', 'starter-workers', '-s', home]).catch(() => undefined);
        await rm(path.join(os.homedir(), 'Library/LaunchAgents', `${c.pool}.plist`), { force: true });
      } else await rm(path.join(os.homedir(), '.config/systemd/user', `${c.pool}.service`), { force: true });
      await removeConvenienceCommand();
      await rm(home, { recursive: true, force: true });
      print('Installation and credential removed. Prepared Docker images retained. Revoke the dedicated GitHub token.'); return;
    default: throw new Error(`Unknown command: ${verb}; use --help`);
  }
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
}
