import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { assert, command, hash } from './core.ts';

interface Manifest { packageManager?: string; engines?: { node?: string }; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; patchedDependencies?: Record<string, string>; overrides?: Record<string, string>; }
export interface Inputs { files: Map<string, string>; fingerprint: string; bun: string; playwright: string; node: string; }
// Read blobs directly: no checkout, hooks, filters, submodules or repository scripts execute on the host.
export async function inputs(git: string, sha: string): Promise<Inputs> {
  assert(/^[a-f0-9]{40}$/.test(sha), 'Expected full commit SHA');
  const tree = await command('git', ['-C', git, 'ls-tree', '-r', '-z', sha]);
  const entries = tree.split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(\d+) blob ([a-f0-9]{40})\t(.+)$/s);
    return match ? { mode: match[1], oid: match[2], file: match[3] } : undefined;
  }).filter(e => e !== undefined);
  const files = new Map<string, string>();
  let total = 0;
  async function add(file: string): Promise<void> {
    if (files.has(file)) return;
    assert(!file.startsWith('/') && !file.split('/').some(p => p === '..' || p === '.' || p === '.git') && ![...file].some(c => c.charCodeAt(0) < 32 || c === '\\'), 'Unsafe dependency input path');
    const entry = entries.find(e => e.file === file);
    assert(entry && ['100644', '100755'].includes(entry.mode), `Missing or non-regular dependency input: ${file}`);
    const size = Number(await command('git', ['-C', git, 'cat-file', '-s', entry.oid]));
    assert(size <= 4 * 1024 * 1024 && (total += size) <= 32 * 1024 * 1024, 'Dependency inputs exceed size limit');
    files.set(file, await command('git', ['-C', git, 'cat-file', 'blob', entry.oid], { raw: true }));
  }
  assert(!entries.some(e => /(^|\/)(\.npmrc|bunfig\.toml)$/.test(e.file)), 'Custom registry/bunfig configuration needs a reviewed preparation recipe; this version supports public npm packages');
  await add('package.json'); await add('bun.lock'); await add('.node-version');
  const lockText = files.get('bun.lock')!;
  // Reject non-npm tarball/git sources before handing the lockfile to Bun's parser.
  for (const match of lockText.matchAll(/https?:[^"\s]+/g)) {
    const url = new URL(match[0]);
    assert(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.username && !url.password, 'Unsupported lockfile download source');
  }
  assert(!/(?:git\+|git@|github:|ssh:)/.test(lockText), 'Git lockfile dependencies require a reviewed preparation recipe');
  for (const e of entries.filter(e => e.file.endsWith('/package.json') && !e.file.includes('/qa/fixtures/'))) await add(e.file);
  const localDirectories = new Set<string>();
  for (const [file, text] of [...files]) {
    if (!file.endsWith('package.json')) continue;
    const m = JSON.parse(text) as Manifest;
    for (const version of Object.values({ ...m.dependencies, ...m.devDependencies, ...m.optionalDependencies, ...m.overrides })) {
      if (version.startsWith('file:')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), version.slice(5)));
        assert(!target.startsWith('../') && !path.posix.isAbsolute(version.slice(5)), 'Local dependency escapes repository');
        localDirectories.add(target);
      } else assert(!/(?:https?:|git[+:]|ssh:|link:|github:|^\.\.?\/)/.test(version), 'Only npm, workspace and repository-local file dependencies are supported');
    }
    for (const patch of Object.values(m.patchedDependencies ?? {})) await add(patch);
  }
  for (const directory of localDirectories) for (const e of entries.filter(e => e.file.startsWith(directory + '/'))) await add(e.file);
  const root = JSON.parse(files.get('package.json')!) as Manifest;
  const bun = root.packageManager?.match(/^bun@(\d+\.\d+\.\d+)$/)?.[1];
  const node = files.get('.node-version')!.trim();
  const versions = [...files].filter(([f]) => f.endsWith('package.json')).flatMap(([, text]) => {
    const m = JSON.parse(text) as Manifest;
    return [m.dependencies?.['@playwright/test'], m.devDependencies?.['@playwright/test']].filter(v => v !== undefined).map(v => v.replace(/^[~^]/, ''));
  });
  assert(bun && /^\d+$/.test(node) && versions.length > 0 && versions.every(v => v === versions[0] && /^\d+\.\d+\.\d+$/.test(v)), 'Expected exact Bun and consistent Playwright versions');
  // The lock's resolved version must agree: a newer caret resolution needs its own tool image.
  const locked = files.get('bun.lock')!.match(/"(?:@playwright\/test|playwright)":\s*\["(?:@playwright\/test|playwright)@(\d+\.\d+\.\d+)"/);
  assert(locked, 'Cannot resolve Playwright from bun.lock');
  return { files, bun, playwright: locked[1], node, fingerprint: hash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)))) };
}
export async function writeInputs(destination: string, input: Inputs): Promise<void> {
  for (const [file, text] of input.files) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}
