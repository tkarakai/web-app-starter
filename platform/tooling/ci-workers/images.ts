import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { api } from './github.ts';
import { assert, catalog, docker, exists, hash, home, label, save, type Config, type Environment } from './core.ts';
import { inputs, writeInputs, type Inputs } from './source.ts';
import { launch, recipe } from './runtime.ts';

interface Asset { name: string; browser_download_url: string; digest: string; }
interface Release { tag_name: string; assets: Asset[]; }
interface Tools { key: string; args: string[]; image?: string; created: string; }
async function asset(repository: string, tag: string, filename: string, destination: string): Promise<string> {
  const release = await api<Release>(`/repos/${repository}/releases/${tag}`);
  const a = release.assets.find(a => a.name === filename.replace('{version}', release.tag_name.replace(/^v/, '')));
  assert(a && /^sha256:[a-f0-9]{64}$/.test(a.digest), `No authenticated checksum for ${repository}/${filename}`);
  const url = new URL(a.browser_download_url);
  assert(url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(`/${repository}/releases/download/`), 'Unexpected release asset URL');
  const blob = path.join(home, 'downloads', a.digest.slice(7));
  await mkdir(path.dirname(blob), { recursive: true, mode: 0o700 });
  if (await exists(blob) && hash(await readFile(blob)) === a.digest.slice(7)) { await cp(blob, destination); return release.tag_name; }
  if (!await exists(destination) || hash(await readFile(destination)) !== a.digest.slice(7)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    assert(response.ok && response.body, 'Release download failed');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.byteLength; assert(size < 400 * 1024 * 1024, 'Release asset too large'); chunks.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(chunks);
    assert(hash(bytes) === a.digest.slice(7), 'Release asset checksum mismatch');
    await writeFile(destination, bytes); await writeFile(blob, bytes);
  }
  return release.tag_name;
}
async function ensureBuilder(c: Config): Promise<void> {
  const name = `${c.pool}-build`;
  try { await docker(c, ['buildx', 'inspect', name]); }
  catch {
    const file = path.join(home, 'buildkitd.toml');
    await writeFile(file, `[worker.oci]\n  gc = true\n[[worker.oci.gcpolicy]]\n  all = true\n  reservedSpace = "1GB"\n  maxUsedSpace = "${Math.max(2, Math.floor(c.diskGiB / 3))}GB"\n`);
    await docker(c, ['buildx', 'create', '--name', name, '--driver', 'docker-container', '--buildkitd-config', file]);
  }
}
async function build(c: Config, directory: string, tools: Tools, target: string, tag: string): Promise<string> {
  await ensureBuilder(c);
  await docker(c, ['buildx', 'build', '--builder', `${c.pool}-build`, '--load', '--target', target,
    ...(target === 'worker' ? ['--no-cache-filter', 'seed'] : []), '--label', `${label}=${c.pool}`, '--tag', tag,
    ...tools.args.flatMap(a => ['--build-arg', a]), directory], { stream: true, timeout: 30 * 60_000 });
  return docker(c, ['image', 'inspect', '--format', '{{.Id}}', tag]);
}
async function toolEnvironment(c: Config, input: Inputs, refresh: boolean): Promise<{ tools: Tools; directory: string }> {
  const engine = JSON.parse(await docker(c, ['info', '--format', '{{json .}}'])) as { Architecture: string; OSType: string };
  assert(engine.OSType === 'linux', 'Linux Docker containers are required');
  const arm = ['aarch64', 'arm64'].includes(engine.Architecture);
  assert(arm || ['x86_64', 'amd64'].includes(engine.Architecture), 'Unsupported Docker architecture');
  const recipeHash = hash((await Promise.all((await readdir(recipe)).filter(f => f !== 'seccomp.json').sort().map(async f => await readFile(path.join(recipe, f), 'utf8')))).join('\0'));
  const key = hash(JSON.stringify([input.node, input.bun, input.playwright, arm, recipeHash]));
  const directory = path.join(home, 'builds', key);
  await mkdir(path.join(directory, 'downloads'), { recursive: true, mode: 0o700 });
  const meta = path.join(directory, 'tools.json');
  if (!refresh && await exists(meta)) {
    const tools = JSON.parse(await readFile(meta, 'utf8')) as Tools;
    if (tools.image) { try { await docker(c, ['image', 'inspect', tools.image]); return { tools, directory }; } catch { /* engine reset: rebuild */ } }
  }
  for (const file of await readdir(recipe)) await cp(path.join(recipe, file), path.join(directory, file));
  await docker(c, ['pull', `node:${input.node}-bookworm-slim`], { stream: true, timeout: 300_000 });
  const nodeImage = await docker(c, ['image', 'inspect', '--format', '{{index .RepoDigests 0}}', `node:${input.node}-bookworm-slim`]);
  const download = (file: string): string => path.join(directory, 'downloads', file);
  const runner = await asset('actions/runner', 'latest', `actions-runner-linux-${arm ? 'arm64' : 'x64'}-{version}.tar.gz`, download('runner.tar.gz'));
  await asset('oven-sh/bun', `tags/bun-v${input.bun}`, `bun-linux-${arm ? 'aarch64' : 'x64'}.zip`, download('bun.zip'));
  const backend = await asset('get-convex/convex-backend', 'latest', `convex-local-backend-${arm ? 'aarch64' : 'x86_64'}-unknown-linux-gnu.zip`, download('backend.zip'));
  const identity = hash(JSON.stringify([key, nodeImage, runner, backend, refresh ? new Date().toISOString().slice(0, 10) : 'initial']));
  const tools: Tools = { key: identity, created: new Date().toISOString(), args: [`NODE_IMAGE=${nodeImage}`, `BUN_VERSION=${input.bun}`, `PLAYWRIGHT_VERSION=${input.playwright}`, `BACKEND_VERSION=${backend}`, `TOOL_KEY=${identity}`] };
  tools.image = await build(c, directory, tools, 'tools', `${c.pool}:tools-${identity.slice(0, 20)}`);
  await launch(c, tools.image, ['smoke']);
  await save(meta, tools);
  return { tools, directory };
}
export async function prepare(c: Config, git: string, sha: string, scope: string, refresh = false): Promise<Environment> {
  const input = await inputs(git, sha);
  const { tools, directory } = await toolEnvironment(c, input, refresh);
  const key = hash(JSON.stringify([c.repo, scope, input.fingerprint, tools.image]));
  const state = await catalog();
  const existing = state.environments.find(e => e.key === key);
  if (existing) {
    try { await docker(c, ['image', 'inspect', existing.image]); existing.used = new Date().toISOString(); await save(path.join(home, 'catalog.json'), state); return existing; }
    catch { state.environments = state.environments.filter(e => e !== existing); }
  }
  await rm(path.join(directory, 'inputs'), { recursive: true, force: true });
  await writeInputs(path.join(directory, 'inputs'), input);
  const image = await build(c, directory, tools, 'worker', `${c.pool}:seed-${key.slice(0, 24)}`);
  await launch(c, image, ['smoke']);
  const environment: Environment = { key, image, tools: tools.image!, scope, source: sha, created: new Date().toISOString(), used: new Date().toISOString(), bytes: Number(await docker(c, ['image', 'inspect', '-f', '{{.Size}}', image])) };
  state.environments.push(environment); state.tools = tools.image; state.toolsCreated = tools.created;
  await save(path.join(home, 'catalog.json'), state);
  // Manifests are private source. Remove their staging copy after the fixed recipe completes.
  await rm(path.join(directory, 'inputs'), { recursive: true, force: true });
  return environment;
}
export async function rotateLogs(): Promise<void> {
  for (const folder of ['logs', 'evidence']) {
    const dir = path.join(home, folder);
    if (!await exists(dir)) continue;
    for (const file of await readdir(dir)) if (Date.now() - (await stat(path.join(dir, file))).mtimeMs > 7 * 86400_000) await rm(path.join(dir, file));
  }
}
