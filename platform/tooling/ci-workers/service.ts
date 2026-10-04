import path from 'node:path';
import os from 'node:os';
import { cp, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assert, command, exists, hash, home, type Config } from './core.ts';

const xml = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const shell = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
export async function install(c: Config): Promise<string> {
  const source = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(home, 'versions', `${Date.now()}-${hash(source).slice(0, 8)}`);
  await mkdir(target, { recursive: true, mode: 0o700 }); await cp(source, target, { recursive: true });
  const current = path.join(home, 'current');
  if (await exists(current)) { const old = await readlink(current); await rm(path.join(home, 'previous'), { force: true }); await symlink(old, path.join(home, 'previous')); }
  const replacement = path.join(home, 'current.next'); await rm(replacement, { force: true }); await symlink(target, replacement);
  const { rename } = await import('node:fs/promises'); await rename(replacement, current);
  const bin = path.join(os.homedir(), '.local/bin'); await mkdir(bin, { recursive: true });
  const wrapper = path.join(bin, 'starter-workers');
  await writeFile(wrapper, `#!/bin/sh\nexport STARTER_WORKERS_HOME=${shell(home)}\nexec ${shell(process.execPath)} ${shell(path.join(current, 'cli.ts'))} "$@"\n`, { mode: 0o755 });
  await mkdir(path.join(home, 'logs'), { recursive: true, mode: 0o700 });
  const environmentPath = `${path.dirname(c.docker)}:${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  if (process.platform === 'darwin') {
    const directory = path.join(os.homedir(), 'Library/LaunchAgents'); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${c.pool}.plist`), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${c.pool}</string><key>ProgramArguments</key><array><string>${xml(wrapper)}</string><string>serve</string></array><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(environmentPath)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(path.join(home, 'logs/manager.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(home, 'logs/manager.log'))}</string></dict></plist>\n`);
  } else {
    assert(process.platform === 'linux', 'Supported hosts: macOS and Linux');
    const directory = path.join(os.homedir(), '.config/systemd/user'); await mkdir(directory, { recursive: true });
    // systemd quoted arguments use backslash escaping, not shell single quotes.
    const quote = (s: string): string => '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
    await writeFile(path.join(directory, `${c.pool}.service`), `[Unit]\nDescription=Starter local workers\n[Service]\nExecStart=${quote(wrapper)} serve\nEnvironment=${quote(`PATH=${environmentPath}`)}\nRestart=on-failure\nRestartSec=30\nTimeoutStopSec=7200\n[Install]\nWantedBy=default.target\n`);
  }
  return wrapper;
}
export async function service(c: Config, start: boolean): Promise<void> {
  if (process.platform === 'darwin') {
    const target = `gui/${process.getuid!()}`;
    if (start) await command('/bin/launchctl', ['bootstrap', target, path.join(os.homedir(), 'Library/LaunchAgents', `${c.pool}.plist`)]);
    else await command('/bin/launchctl', ['bootout', `${target}/${c.pool}`]);
  } else {
    await command('systemctl', ['--user', 'daemon-reload']);
    await command('systemctl', ['--user', start ? 'enable' : 'disable', '--now', `${c.pool}.service`]);
  }
}
