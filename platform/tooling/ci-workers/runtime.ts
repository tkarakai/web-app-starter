import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, docker, hash, home, label, type Config } from './core.ts';

export const recipe = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recipe');
export function runtimePolicy(c: Config): Record<string, unknown> {
  return { user: '1001:1001', capabilities: [], noNewPrivileges: true, network: 'filtered-proxy-v1',
    mounts: [], cpus: c.cpus, memoryGiB: c.memoryGiB, pids: 2048, shmGiB: 1, seccomp: hash(readFileSync(path.join(recipe, 'seccomp.json'))), protocol: 1 };
}
export async function launch(c: Config, image: string, mode: string[], input?: string, beforeStart?: (name: string) => Promise<void>, runId?: number): Promise<string> {
  assert(/^sha256:[a-f0-9]{64}$/.test(image), 'Launch requires immutable local image ID');
  const id = `${c.pool}-${randomUUID().slice(0, 12)}`;
  const net = `${id}-net`, proxy = `${id}-proxy`, guard = `${id}-guard`, worker = `${id}-worker`;
  const ownership = ['--label', `${label}=${c.pool}`, '--label', `${label}.lease=${id}`, ...(runId ? ['--label', `${label}.run=${runId}`] : [])];
  try {
    await docker(c, ['network', 'create', '--internal', ...ownership, net]);
    await docker(c, ['create', '--name', proxy, ...ownership, '--network', net, '--user', 'proxy', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--pids-limit', '128', '--entrypoint', '/usr/sbin/squid', image, '-N', '-f', '/opt/starter/squid.conf']);
    // Only the fixed proxy can reach public endpoints; no job runs in its namespace.
    await docker(c, ['network', 'connect', 'bridge', proxy]);
    await docker(c, ['start', proxy]);
    const proxyAddress = await docker(c, ['inspect', '-f', `{{(index .NetworkSettings.Networks "${net}").IPAddress}}`, proxy]);
    assert(/^\d+\.\d+\.\d+\.\d+$/.test(proxyAddress), 'Proxy has no IPv4 address');
    await docker(c, ['run', '-d', '--name', guard, ...ownership, '--network', net, '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN', '--security-opt', 'no-new-privileges', '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1', '--memory', '64m', '--pids-limit', '32', '--entrypoint', '/opt/starter/firewall.sh', image, proxyAddress]);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await docker(c, ['exec', guard, 'test', '-f', '/tmp/ready']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert(ready, `Network firewall failed to initialize: ${await docker(c, ['logs', guard])}`);
    const policy = hash(JSON.stringify(runtimePolicy(c)));
    await docker(c, ['create', '-i', '--name', worker, ...ownership,
      '--network', `container:${guard}`, '--user', '1001:1001', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--security-opt', `seccomp=${path.join(recipe, 'seccomp.json')}`,
      '--cpus', String(c.cpus), '--memory', `${c.memoryGiB}g`, '--memory-swap', `${c.memoryGiB}g`, '--pids-limit', '2048', '--shm-size', '1g',
      '--env', `STARTER_WORKER_IMAGE=${image}`, '--env', `STARTER_WORKER_RUNTIME=${policy}`,
      ...['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'].flatMap(k => ['--env', `${k}=http://${proxyAddress}:3128`]),
      '--env', 'NODE_USE_ENV_PROXY=1', '--env', 'NO_PROXY=localhost,127.0.0.1,::1', '--env', 'no_proxy=localhost,127.0.0.1,::1', image, ...mode]);
    const actual = JSON.parse(await docker(c, ['inspect', worker])) as { Image: string; Mounts: unknown[]; HostConfig: { Privileged: boolean; RestartPolicy: { Name: string } } }[];
    assert(actual[0].Image === image && actual[0].Mounts.length === 0 && !actual[0].HostConfig.Privileged && actual[0].HostConfig.RestartPolicy.Name === 'no', 'Container launch policy mismatch');
    if (beforeStart) await beforeStart(worker);
    await mkdir(path.join(home, 'evidence'), { recursive: true, mode: 0o700 });
    await writeFile(path.join(home, 'evidence', `${id}.json`), JSON.stringify({ image, policy, settings: runtimePolicy(c), created: new Date().toISOString(), mode: mode[0] }), { mode: 0o600 });
    const output = await docker(c, ['start', '-ai', worker], { input, timeout: 2 * 3600_000 });
    return output;
  } finally {
    try {
      const logs = await docker(c, ['logs', worker]).catch(() => 'Container did not start');
      await mkdir(path.join(home, 'logs'), { recursive: true, mode: 0o700 });
      await writeFile(path.join(home, 'logs', `${id}.log`), logs.slice(-4 * 1024 * 1024), { mode: 0o600 });
    } finally {
      for (const container of [worker, guard, proxy]) await docker(c, ['rm', '-f', container]).catch(() => undefined);
      await docker(c, ['network', 'rm', net]).catch(() => undefined);
    }
  }
}
export async function reconcile(c: Config): Promise<void> {
  for (const kind of ['container', 'network']) {
    const ids = (await docker(c, [kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '-q', '--filter', `label=${label}=${c.pool}`])).split(/\s+/).filter(Boolean);
    for (const id of ids) await docker(c, [kind, 'rm', ...(kind === 'container' ? ['-f'] : []), id]);
  }
}
