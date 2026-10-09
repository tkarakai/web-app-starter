import path from 'node:path';
import os from 'node:os';
import { cp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assert, command, exists, hash, home, save, type Config } from './core.ts';

const xml = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const shell = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
export function serviceDefinition(pool: string): string {
  return process.platform === 'darwin' ? path.join(os.homedir(), 'Library/LaunchAgents', pool + '.plist') : path.join(os.homedir(), '.config/systemd/user', pool + '.service');
}
async function installationDigests(pool: string, directory: string): Promise<string[]> {
  return Promise.all([path.join(directory, 'starter-workers'), path.join(directory, 'current/cli.ts'), serviceDefinition(pool)].map(async file => hash(await readFile(file))));
}
export async function installationComplete(pool: string, directory: string = home): Promise<boolean> {
  try {
    const receipt = JSON.parse(await readFile(path.join(directory, 'installation.json'), 'utf8'));
    const digests = await installationDigests(pool, directory);
    return receipt.pool === pool && JSON.stringify(receipt.digests) === JSON.stringify(digests);
  } catch { return false; }
}
export async function install(c: Config): Promise<string> {
  assert(!await exists(path.join(home, 'daemon.lock')), 'Stop the manager before installing');
  await rm(path.join(home, 'installation.json'), { force: true });
  const source = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(home, 'versions', `${Date.now()}-${hash(source).slice(0, 8)}`);
  await mkdir(target, { recursive: true, mode: 0o700 }); await cp(source, target, { recursive: true });
  const current = path.join(home, 'current');
  if (await exists(current)) { const old = await readlink(current); await rm(path.join(home, 'previous'), { force: true }); await symlink(old, path.join(home, 'previous')); }
  const replacement = path.join(home, 'current.next'); await rm(replacement, { force: true }); await symlink(target, replacement);
  const { rename } = await import('node:fs/promises'); await rename(replacement, current);
  const wrapper = path.join(home, 'starter-workers');
  await writeFile(wrapper, `#!/bin/sh\nexport STARTER_WORKERS_HOME=${shell(home)}\nexec ${shell(process.execPath)} ${shell(path.join(current, 'cli.ts'))} "$@"\n`, { mode: 0o755 });
  if (c.convenienceCommand !== false) {
    const bin = path.join(os.homedir(), '.local/bin'); await mkdir(bin, { recursive: true });
    await cp(wrapper, path.join(bin, 'starter-workers'));
  }
  await mkdir(path.join(home, 'logs'), { recursive: true, mode: 0o700 });
  const environmentPath = `${path.dirname(c.docker)}:${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  if (process.platform === 'darwin') {
    const directory = path.join(os.homedir(), 'Library/LaunchAgents'); await mkdir(directory, { recursive: true });
    await writeFile(serviceDefinition(c.pool), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${c.pool}</string><key>ProgramArguments</key><array><string>${xml(wrapper)}</string><string>serve</string></array><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(environmentPath)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(path.join(home, 'logs/manager.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(home, 'logs/manager.log'))}</string></dict></plist>\n`);
  } else {
    assert(process.platform === 'linux', 'Supported hosts: macOS and Linux');
    const directory = path.join(os.homedir(), '.config/systemd/user'); await mkdir(directory, { recursive: true });
    // systemd quoted arguments use backslash escaping, not shell single quotes.
    const quote = (s: string): string => '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
    await writeFile(serviceDefinition(c.pool), `[Unit]\nDescription=Starter local workers\n[Service]\nExecStart=${quote(wrapper)} serve\nEnvironment=${quote(`PATH=${environmentPath}`)}\nRestart=on-failure\nRestartSec=30\nTimeoutStopSec=7200\n[Install]\nWantedBy=default.target\n`);
  }
  await save(path.join(home, 'installation.json'), { pool: c.pool, digests: await installationDigests(c.pool, home) });
  return wrapper;
}
export async function service(c: Config, start: boolean): Promise<void> {
  if (process.platform === 'darwin') {
    const target = `gui/${process.getuid!()}`;
    if (start) await command('/bin/launchctl', ['bootstrap', target, serviceDefinition(c.pool)]);
    else await command('/bin/launchctl', ['bootout', `${target}/${c.pool}`]);
  } else {
    await command('systemctl', ['--user', 'daemon-reload']);
    await command('systemctl', ['--user', start ? 'enable' : 'disable', '--now', `${c.pool}.service`]);
  }
}

export async function removeConvenienceCommand(): Promise<void> {
  const wrapper = path.join(os.homedir(), '.local/bin/starter-workers');
  const owned = path.join(home, 'starter-workers');
  if (await exists(wrapper) && await exists(owned) && await readFile(wrapper, 'utf8') === await readFile(owned, 'utf8')) await rm(wrapper, { force: true });
}
