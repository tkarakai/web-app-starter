import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, command, validateRepo } from './core.ts';

// Shared by GitHub CI and archive checks. Never broaden a failed fetch to tags/history.
export async function ensureBaseline(root = process.cwd(), repository = process.env.PLATFORM_SOURCE_REPOSITORY || 'tkarakai/web-app-starter'): Promise<void> {
  let text: string;
  try { text = await readFile(path.join(root, '.platform-base.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const base: unknown = JSON.parse(text);
  assert(base !== null && typeof base === 'object' && !Array.isArray(base), 'Invalid platform baseline');
  const commit = (base as { commit?: unknown }).commit;
  assert(typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit), 'Invalid platform baseline commit');
  validateRepo(repository);
  const git = (args: string[]): Promise<string> => command('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000,
  });
  try { await git(['cat-file', '-e', `${commit}^{commit}`]); return; }
  catch { /* Only a missing baseline needs network access. */ }
  assert(commit.length === 40, 'Missing platform baseline requires a full commit SHA');
  await git(['fetch', '--no-tags', '--depth=1', `https://github.com/${repository}.git`, commit]);
  await git(['cat-file', '-e', `${commit}^{commit}`]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  ensureBaseline().catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
}
