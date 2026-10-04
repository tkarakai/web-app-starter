import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const protocol = 1;
export const label = 'dev.starter.workers';
export const home = process.env.STARTER_WORKERS_HOME || path.join(os.homedir(), '.local/share/starter-workers');
export interface Config {
  version: number; repo: string; pool: string; docker: string; context: string;
  concurrency: number; memoryGiB: number; diskGiB: number; cpus: number;
  paused: boolean; pauseRequest?: string; localOnly: boolean; publicBranch?: string; tokenExpiry?: string;
  previousRouting?: string; enabled?: boolean; installedAt: string;
}
export interface Environment {
  key: string; image: string; tools: string; scope: string; source: string;
  created: string; used: string; bytes: number;
}
export interface ToolImage { image: string; manifest: string; created: string; }
export interface Catalog { toolchains?: Record<string, ToolImage>; environments: Environment[]; lastRefresh?: string; tools?: string; toolsCreated?: string; }
export interface Run { id: number; head_sha: string; head_branch: string; event: string;
  pull_requests: { number: number; head: { sha: string; repo: { id: number } }; base: { sha: string; repo: { id: number } } }[];
}
export interface Job { id: number; status: string; labels: string[]; }
export function installationPool(): string { return `starter-${randomUUID().replaceAll('-', '')}`; }
export function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function repository(remote: string): string {
  const match = remote.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  assert(match, 'origin must be a github.com HTTPS or SSH repository (or supply --repo owner/name)');
  return validateRepo(match[1]);
}
export function validateRepo(repo: string): string {
  assert(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repo), 'Invalid GitHub owner/repository');
  return repo;
}
export function sourceRequest(config: Config, run: Run, job: Job, repoId: number): { sha: string; scope: string } | undefined {
  if (!job.labels.includes(config.pool) || !job.labels.includes(`starter-run-${run.id}`)) return;
  const sources = job.labels.filter(l => l.startsWith('starter-source-'));
  if (sources.length !== 1 || !/^starter-source-[a-f0-9]{40}$/.test(sources[0])) return;
  const sha = sources[0].slice(15);
  if (config.publicBranch && (run.event !== 'workflow_dispatch' || run.head_branch !== config.publicBranch)) return;
  if (run.event === 'pull_request') {
    const pr = run.pull_requests[0];
    if (!pr || pr.head.repo.id !== repoId || pr.base.repo.id !== repoId) return;
    // PR merge revisions are independently checked against their authenticated parents by the manager.
    return { sha, scope: `pr-${pr.number}` };
  }
  if (!['push', 'workflow_dispatch'].includes(run.event) || sha !== run.head_sha) return;
  return { sha, scope: `branch-${hash(run.head_branch).slice(0, 16)}` };
}
export async function command(executable: string, args: string[], options: {
  cwd?: string; input?: string | Buffer; env?: Record<string, string | undefined>; timeout?: number; stream?: boolean; raw?: boolean;
} = {}): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '';
    let cancelled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const killGroup = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { return; }
    };
    const terminate = (): void => {
      cancelled = true;
      killGroup('SIGTERM');
      escalation ??= setTimeout(() => killGroup('SIGKILL'), 10_000);
    };
    const finish = (): void => {
      clearTimeout(timer); clearTimeout(escalation);
      if (cancelled) killGroup('SIGKILL');
      process.off('SIGTERM', terminate); process.off('SIGINT', terminate);
    };
    process.on('SIGTERM', terminate); process.on('SIGINT', terminate);
    const timer = setTimeout(terminate, options.timeout ?? 120_000);
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); if (options.stream) process.stdout.write(data); if (stdout.length > 64 * 1024 * 1024) terminate(); });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-16000); if (options.stream) process.stderr.write(data); });
    child.on('error', error => { finish(); reject(error); });
    child.on('close', code => { finish(); if (code === 0 && !cancelled) resolve(options.raw ? stdout : stdout.trim()); else reject(new Error(`${path.basename(executable)} ${args[0]} failed (${code}): ${stderr}`)); });
    child.stdin.on('error', () => { /* exit status reports a failed receiver */ });
    child.stdin.end(options.input);
  });
}
export async function readJson<T>(file: string, fallback?: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as { code?: string }).code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
export async function save(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file);
}
export async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }
export async function config(): Promise<Config> { return readJson<Config>(path.join(home, 'config.json')); }
export async function catalog(): Promise<Catalog> { return readJson<Catalog>(path.join(home, 'catalog.json'), { environments: [] }); }
export async function docker(c: Config, args: string[], options: Parameters<typeof command>[2] = {}): Promise<string> {
  return command(c.docker, ['--context', c.context, ...args], options);
}
export function expiredEnvironments(entries: Environment[], active: Set<string>, now = Date.now()): Environment[] {
  const retained = new Set<string>(active);
  for (const scope of new Set(entries.map(e => e.scope).filter(scope => !scope.startsWith('pr-')))) {
    entries.filter(e => e.scope === scope).sort((a, b) => b.created.localeCompare(a.created)).slice(0, 2).forEach(e => retained.add(e.image));
  }
  return entries.filter(e => !retained.has(e.image) && now - Date.parse(e.used) > 7 * 86400_000);
}
