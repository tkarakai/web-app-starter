import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { assert, command, hash } from './core.ts';

interface Manifest { packageManager?: string; engines?: { node?: string }; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; patchedDependencies?: Record<string, string>; overrides?: Record<string, string>; }
export interface Inputs { files: Map<string, string>; fingerprint: string; bun: string; playwright: string; node: string; nodeFloor: number; }

function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Unsupported dependency record');
  return value as Record<string, unknown>;
}
function dependency(value: unknown): void {
  assert(typeof value === 'string', 'Dependency spec must be a string');
  const local = value.match(/^(?:workspace:|file:)(.+)$/);
  if (local) {
    assert(!local[1].includes('\\') && !local[1].startsWith('/') && !local[1].split('/').includes('..') && !local[1].includes(':'), 'Unsafe local dependency');
    return;
  }
  const npm = value.replace(/^npm:(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+@/, '');
  assert(/^[a-zA-Z0-9*^~<>=| .+-]+$/.test(npm), 'Only npm, workspace and repository-local file dependencies are supported');
}
function sources(value: unknown): void {
  for (const version of Object.values(record(value))) dependency(version);
}
function download(value: unknown): void {
  assert(typeof value === 'string', 'Unsupported lockfile download source');
  if (!value) return;
  const url = new URL(value);
  assert(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.port && !url.username && !url.password, 'Unsupported lockfile download source');
}
function decoded(text: string, jsonc = false): unknown {
  const raw = text.match(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s+|[^\s]/g) ?? [];
  const tokens = raw.filter(t => !/^\s/.test(t) && !(jsonc && (t.startsWith('//') || t.startsWith('/*'))));
  const frames: (Set<string> | undefined)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{' || token === '[') { frames.push(token === '{' ? new Set() : undefined); assert(frames.length <= 64, 'Dependency data nesting exceeds limit'); }
    else if (token === '}' || token === ']') frames.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const keys = frames.at(-1);
      const key = JSON.parse(token) as string;
      assert(keys && !keys.has(key), 'Duplicate dependency data key');
      keys.add(key);
    }
  }
  return JSON.parse(tokens.filter((t, i, all) => !jsonc || t !== ',' || !['}', ']'].includes(all[i + 1])).join(''));
}
export function lockData(text: string): { packages: Record<string, string[]> } {
  assert(text.length <= 4 * 1024 * 1024, 'Lockfile exceeds size limit');
  const lock = record(decoded(text, true));
  assert((lock.lockfileVersion === 1 || lock.lockfileVersion === 2) && Object.keys(lock).every(k => ['lockfileVersion', 'configVersion', 'workspaces', 'packages', 'overrides', 'patchedDependencies'].includes(k)), 'Unsupported Bun lockfile schema');
  if (lock.configVersion !== undefined) assert(lock.configVersion === 1, 'Unsupported Bun lockfile config');
  for (const workspace of Object.values(record(lock.workspaces))) {
    const data = record(workspace);
    assert(Object.keys(data).every(k => ['name', 'version', 'bin', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].includes(k)), 'Unsupported lock workspace field');
    if (data.bin !== undefined) assert(typeof data.bin === 'string' || Object.values(record(data.bin)).every(v => typeof v === 'string'), 'Unsupported workspace bin');
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) if (data[key] !== undefined) sources(data[key]);
  }
  if (lock.overrides !== undefined) sources(lock.overrides);
  if (lock.patchedDependencies !== undefined) for (const value of Object.values(record(lock.patchedDependencies))) {
    assert(typeof value === 'string' && !value.startsWith('/') && !value.split('/').includes('..') && !value.includes('\\') && !value.includes(':'), 'Unsafe lock patch');
  }
  const packages = record(lock.packages);
  for (const entry of Object.values(packages)) {
    assert(Array.isArray(entry) && typeof entry[0] === 'string', 'Unsupported lock package tuple');
    const locator = entry[0].match(/^(?:@[^/@]+\/)?[^/@]+@(.+)$/);
    assert(locator, 'Unsupported lock package locator');
    dependency(locator[1]);
    const local = /^(workspace:|file:)/.test(locator[1]);
    assert(local ? entry.length === 1 || entry.length === 2 : entry.length === 4, 'Unsupported lock package tuple');
    if (!local) { download(entry[1]); assert(typeof entry[3] === 'string' && /^sha(?:256|512)-[A-Za-z0-9+/=]+$/.test(entry[3]), 'Expected npm integrity'); }
    const metadata = local ? entry[1] : entry[2];
    if (metadata !== undefined) {
      const data = record(metadata);
      assert(Object.keys(data).every(k => ['dependencies', 'optionalDependencies', 'peerDependencies', 'optionalPeers', 'bundled', 'bin', 'os', 'cpu'].includes(k)), 'Unsupported lock package metadata');
      if (data.bundled !== undefined) assert(typeof data.bundled === 'boolean', 'Unsupported bundled package flag');
      for (const key of ['optionalPeers']) if (data[key] !== undefined) assert(Array.isArray(data[key]) && (data[key] as unknown[]).every(v => typeof v === 'string'), 'Unsupported package list');
      for (const key of ['bin', 'os', 'cpu']) if (data[key] !== undefined) assert(typeof data[key] === 'string' || (key === 'bin' ? Object.values(record(data[key])).every(v => typeof v === 'string') : Array.isArray(data[key]) && (data[key] as unknown[]).every(v => typeof v === 'string')), 'Unsupported package metadata value');
      for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) if (data[key] !== undefined) sources(data[key]);
    }
  }
  return { packages: packages as Record<string, string[]> };
}

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
  const lock = lockData(lockText);
  for (const e of entries.filter(e => e.file.endsWith('/package.json') && !e.file.includes('/qa/fixtures/'))) await add(e.file);
  const localDirectories = new Set<string>();
  for (const [file, text] of [...files]) {
    if (!file.endsWith('package.json')) continue;
    const m = decoded(text) as Manifest;
    for (const version of Object.values({ ...m.dependencies, ...m.devDependencies, ...m.optionalDependencies, ...m.overrides })) {
      if (version.startsWith('file:')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), version.slice(5)));
        assert(!target.startsWith('../') && !path.posix.isAbsolute(version.slice(5)), 'Local dependency escapes repository');
        localDirectories.add(target);
      } else dependency(version);
    }
    for (const patch of Object.values(m.patchedDependencies ?? {})) await add(patch);
  }
  for (const directory of localDirectories) for (const e of entries.filter(e => e.file.startsWith(directory + '/'))) await add(e.file);
  const root = decoded(files.get('package.json')!) as Manifest;
  const bun = root.packageManager?.match(/^bun@(\d+\.\d+\.\d+)$/)?.[1];
  const node = files.get('.node-version')!.trim();
  const range = root.engines?.node?.match(/^>=(\d+)\.(\d+) <(\d+)$/);
  assert(root.engines?.node === `${node}.x` || (range && range[1] === node && Number(range[3]) === Number(node) + 1), 'Unsupported engines.node range');
  const nodeFloor = range ? Number(range[2]) : 0;
  const versions = [...files].filter(([f]) => f.endsWith('package.json')).flatMap(([, text]) => {
    const m = decoded(text) as Manifest;
    return [m.dependencies?.['@playwright/test'], m.devDependencies?.['@playwright/test']].filter(v => v !== undefined).map(v => v.replace(/^[~^]/, ''));
  });
  assert(bun && /^\d+$/.test(node) && versions.length > 0 && versions.every(v => v === versions[0] && /^\d+\.\d+\.\d+$/.test(v)), 'Expected exact Bun and consistent Playwright versions');
  const locked = lock.packages['playwright'] ?? lock.packages['@playwright/test'];
  const resolved = locked?.[0].match(/^(?:@playwright\/test|playwright)@(\d+\.\d+\.\d+)$/)?.[1];
  assert(resolved, 'Cannot resolve Playwright from bun.lock');
  return { files, bun, playwright: resolved, node, nodeFloor, fingerprint: hash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)))) };
}
export async function writeInputs(destination: string, input: Inputs): Promise<void> {
  for (const [file, text] of input.files) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}
