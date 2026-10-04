import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assert, command, exists, home, type Config } from './core.ts';

export async function token(): Promise<string> {
  if (process.platform === 'darwin') return command('/usr/bin/security', ['find-generic-password', '-a', 'starter-workers', '-s', home, '-w']);
  return (await readFile(path.join(home, 'credential'), 'utf8')).trim();
}
export async function storeToken(value: string): Promise<void> {
  assert(value.length > 20 && !/\s/.test(value), 'Invalid token');
  if (process.platform === 'darwin') {
    // security's interactive mode reads the credential from stdin, never the process argument list.
    assert(!/["\\]/.test(value), 'Invalid token characters');
    await command('/usr/bin/security', ['-i'], { input: `add-generic-password -U -a starter-workers -s "${home.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" -w "${value}"\n` });
  } else {
    await writeFile(path.join(home, 'credential'), value, { mode: 0o600 });
    await chmod(path.join(home, 'credential'), 0o600);
  }
}
const responses = new Map<string, { etag: string; data: unknown }>();
export async function api<T>(endpoint: string, credential?: string, body?: unknown, method?: string): Promise<T> {
  assert(endpoint.startsWith('/') && !endpoint.startsWith('//'), 'Invalid API path');
  const cacheKey = endpoint + (credential ? ':authenticated' : ':public');
  const cached = !body && !method ? responses.get(cacheKey) : undefined;
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(cached ? { 'If-None-Match': cached.etag } : {}), ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (response.status === 304 && cached) return cached.data as T;
  if (!response.ok) throw new Error(`GitHub ${endpoint.split('?')[0]}: HTTP ${response.status}; check credential permissions, expiry and API limits`);
  const data = response.status === 204 ? undefined : await response.json();
  const etag = response.headers.get('etag');
  if (!body && !method && etag) responses.set(cacheKey, { etag, data });
  return data as T;
}
export async function remoteSource(c: Config, sha: string, credential: string): Promise<string> {
  assert(/^[a-f0-9]{40}$/.test(sha), 'Invalid source revision');
  const mirror = path.join(home, 'source.git');
  if (!await exists(mirror)) { await mkdir(mirror, { recursive: true, mode: 0o700 }); await command('git', ['init', '--bare', mirror]); }
  // No credential is persisted in git config or in process arguments. No source is checked out.
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${credential}`).toString('base64')}`,
    GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null', GIT_CONFIG_KEY_2: 'credential.helper', GIT_CONFIG_VALUE_2: '' };
  await command('git', ['-C', mirror, 'fetch', '--no-tags', '--depth=1', `https://github.com/${c.repo}.git`, sha], { env });
  return mirror;
}

export async function routingVariables(c: Pick<Config, 'repo'>): Promise<Map<string, string>> {
  const data: unknown = JSON.parse(await command('gh', ['variable', 'list', '--repo', c.repo, '--json', 'name,value']));
  assert(Array.isArray(data) && data.every(v => v && typeof v.name === 'string' && typeof v.value === 'string'), 'Invalid repository variable response');
  return new Map(data.map(v => [v.name as string, v.value as string]));
}
