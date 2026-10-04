import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { api } from './github.ts';
import { assert, catalog, command, docker, exists, hash, home, label, readJson, save, type Catalog, type Config, type Environment, type ToolImage } from './core.ts';
import { inputs, writeInputs, type Inputs } from './source.ts';
import { launch, recipe } from './runtime.ts';

interface Asset { name: string; browser_download_url: string; digest: string; }
interface Release { tag_name: string; assets: Asset[]; }
async function asset(repository: string, tag: string, filename: string, destination: string): Promise<string> {
  const release = await api<Release>(`/repos/${repository}/releases/${tag}`);
  const a = release.assets.find(a => a.name === filename.replace('{version}', release.tag_name.replace(/^v/, '')));
  assert(a && /^sha256:[a-f0-9]{64}$/.test(a.digest), `No authenticated checksum for ${repository}/${filename}`);
  const url = new URL(a.browser_download_url);
  assert(url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(`/${repository}/releases/download/`), 'Unexpected release asset URL');
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  assert(response.ok && response.body, 'Release download failed');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.byteLength; assert(size < 400 * 1024 * 1024, 'Release asset too large'); chunks.push(Buffer.from(chunk)); }
  const bytes = Buffer.concat(chunks);
  assert(hash(bytes) === a.digest.slice(7), 'Release asset checksum mismatch');
  await writeFile(destination, bytes);
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
async function build(c: Config, directory: string, tag: string, options: string[]): Promise<string> {
  await ensureBuilder(c);
  await docker(c, ['buildx', 'build', '--builder', `${c.pool}-build`, '--provenance=false',
    '--label', `${label}=${c.pool}`, '--tag', tag, ...options, directory], { stream: true, timeout: 30 * 60_000 });
  return docker(c, ['image', 'inspect', '--format', '{{.Id}}', tag]);
}
export function toolLayout(image: string): string {
  assert(/^sha256:[a-f0-9]{64}$/.test(image), 'Expected immutable tool image ID');
  return path.join(home, 'tool-layouts', image.slice(7));
}
async function toolEnvironment(c: Config, input: Inputs, refresh: boolean, state: Catalog, directory: string, tag: string): Promise<{ tools: ToolImage; family: string; layout: string }> {
  const engine = JSON.parse(await docker(c, ['info', '--format', '{{json .}}'])) as { Architecture: string; OSType: string };
  assert(engine.OSType === 'linux', 'Linux Docker containers are required');
  const arm = ['aarch64', 'arm64'].includes(engine.Architecture);
  assert(arm || ['x86_64', 'amd64'].includes(engine.Architecture), 'Unsupported Docker architecture');
  const recipeHash = hash((await Promise.all((await readdir(recipe)).filter(f => f !== 'seccomp.json').sort().map(async f => await readFile(path.join(recipe, f), 'utf8')))).join('\0'));
  const family = hash(JSON.stringify([input.node, input.nodeFloor, input.bun, input.playwright, arm, recipeHash]));
  const cached = state.toolchains?.[family];
  if (!refresh && cached && await exists(toolLayout(cached.image))) {
    try { await docker(c, ['image', 'inspect', cached.image]); return { tools: cached, family, layout: toolLayout(cached.image) }; }
    catch { state.toolchains = Object.fromEntries(Object.entries(state.toolchains!).filter(([key]) => key !== family)); }
  }
  const context = path.join(directory, 'tools');
  await mkdir(path.join(context, 'downloads'), { recursive: true, mode: 0o700 });
  for (const file of await readdir(recipe)) await cp(path.join(recipe, file), path.join(context, file));
  await docker(c, ['pull', `node:${input.node}-bookworm-slim`], { stream: true, timeout: 300_000 });
  const nodeImage = await docker(c, ['image', 'inspect', '--format', '{{index .RepoDigests 0}}', `node:${input.node}-bookworm-slim`]);
  const download = (file: string): string => path.join(context, 'downloads', file);
  const runner = await asset('actions/runner', 'latest', `actions-runner-linux-${arm ? 'arm64' : 'x64'}-{version}.tar.gz`, download('runner.tar.gz'));
  await asset('oven-sh/bun', `tags/bun-v${input.bun}`, `bun-linux-${arm ? 'aarch64' : 'x64'}.zip`, download('bun.zip'));
  const backend = await asset('get-convex/convex-backend', 'latest', `convex-local-backend-${arm ? 'aarch64' : 'x86_64'}-unknown-linux-gnu.zip`, download('backend.zip'));
  const identity = hash(JSON.stringify([family, nodeImage, runner, backend, new Date().toISOString().slice(0, 10)]));
  const args = [`NODE_IMAGE=${nodeImage}`, `BUN_VERSION=${input.bun}`, `PLAYWRIGHT_VERSION=${input.playwright}`, `BACKEND_VERSION=${backend}`, `TOOL_KEY=${identity}`];
  const layout = path.join(directory, 'layout');
  const image = await build(c, context, tag, ['--target', 'tools', '--output', 'type=docker', '--output', `type=oci,dest=${layout},tar=false`, ...args.flatMap(a => ['--build-arg', a])]);
  const index = await readJson<{ manifests: { digest: string }[] }>(path.join(layout, 'index.json'));
  assert(index.manifests.length === 1 && /^sha256:[a-f0-9]{64}$/.test(index.manifests[0].digest), 'Expected a single OCI tool manifest');
  const manifest = index.manifests[0].digest;
  const document = await readJson<{ config: { digest: string } }>(path.join(layout, 'blobs/sha256', manifest.slice(7)));
  assert(/^sha256:[a-f0-9]{64}$/.test(document.config.digest), 'Expected OCI tool configuration digest');
  const exported = await readJson<{ architecture: string; os: string; rootfs: { diff_ids: string[] }; config: Record<string, unknown> }>(path.join(layout, 'blobs/sha256', document.config.digest.slice(7)));
  const [loaded] = JSON.parse(await docker(c, ['image', 'inspect', image])) as { Architecture: string; Os: string; RootFS: { Layers: string[] }; Config: Record<string, unknown> }[];
  assert(exported.architecture === loaded.Architecture && exported.os === loaded.Os && isDeepStrictEqual(exported.rootfs.diff_ids, loaded.RootFS.Layers) && Object.entries(exported.config).every(([key, value]) => isDeepStrictEqual(value, loaded.Config[key])), 'OCI layout does not match the loaded tool image');
  const version = await launch(c, image, ['exec', 'node', '--version']);
  const runtime = version.trim().match(/^v(\d+)\.(\d+)\.(\d+)$/);
  assert(runtime && runtime[1] === input.node && Number(runtime[2]) >= input.nodeFloor, 'Prepared Node runtime is below engines.node floor');
  await launch(c, image, ['smoke']);
  return { tools: { image, manifest, created: new Date().toISOString() }, family, layout };
}
export async function prepare(c: Config, git: string, sha: string, scope: string, refresh = false): Promise<Environment> {
  const input = await inputs(git, sha);
  const state = await catalog();
  const retained = new Set([state.tools, ...state.environments.flatMap(e => [e.image, e.tools]), ...Object.values(state.toolchains ?? {}).map(t => t.image)]);
  await mkdir(path.join(home, 'candidates'), { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(home, 'candidates/preparation-'));
  const suffix = path.basename(directory);
  const toolTag = `${c.pool}:tools-candidate-${suffix}`, seedTag = `${c.pool}:seed-candidate-${suffix}`;
  const promotions: string[] = [];
  let promoted = false, movedLayout: string | undefined;
  try {
    const { tools, family, layout } = await toolEnvironment(c, input, refresh, state, directory, toolTag);
    const key = hash(JSON.stringify([c.repo, scope, input.fingerprint, tools.image]));
    const existing = state.environments.find(e => e.key === key);
    let available = false;
    if (existing) {
      try { await docker(c, ['image', 'inspect', existing.image]); available = true; } catch { available = false; }
      if (available && layout === toolLayout(tools.image)) { existing.source = sha; existing.used = new Date().toISOString(); await save(path.join(home, 'catalog.json'), state); return existing; }
    }
    const context = path.join(directory, 'seed');
    await mkdir(context);
    await cp(path.join(recipe, 'seed.Dockerfile'), path.join(context, 'Dockerfile'));
    await writeInputs(path.join(context, 'inputs'), input);
    const image = available ? existing!.image : await build(c, context, seedTag, ['--load', '--target', 'worker', '--no-cache-filter', 'seed', '--build-context', `validated-tools=oci-layout://${layout}@${tools.manifest}`]);
    await launch(c, image, ['smoke']);
    const archive = path.join(directory, 'source.tar');
    await command('git', ['-C', git, 'archive', '--format=tar', '-o', archive, sha]);
    await launch(c, image, ['exec', '/bin/bash', '-c', 'tar --no-same-owner -xf /work/source.tar -C /work && rm /work/source.tar && bun install --offline --frozen-lockfile'], undefined, async name => { await docker(c, ['cp', archive, `${name}:/work/source.tar`]); });
    const environment: Environment = { key, image, tools: tools.image, scope, source: sha, created: new Date().toISOString(), used: new Date().toISOString(), bytes: Number(await docker(c, ['image', 'inspect', '-f', '{{.Size}}', image])) };
    for (const [id, tag] of [[tools.image, `${c.pool}:tools-${tools.image.slice(7)}`], [image, `${c.pool}:seed-${key.slice(0, 24)}`]]) {
      if (!retained.has(id)) promotions.push(tag);
      await docker(c, ['tag', id, tag]);
    }
    const destination = toolLayout(tools.image);
    if (layout !== destination && !await exists(destination)) {
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await rename(layout, destination);
      movedLayout = destination;
    }
    state.environments = [...state.environments.filter(e => e.key !== key), environment];
    state.tools = tools.image; state.toolsCreated = tools.created;
    state.toolchains = { ...state.toolchains, [family]: tools };
    await save(path.join(home, 'catalog.json'), state);
    promoted = true;
    return environment;
  } finally {
    for (const tag of [toolTag, seedTag, ...(!promoted ? promotions : [])]) await docker(c, ['image', 'rm', tag]).catch(() => undefined);
    if (!promoted && movedLayout && !retained.has(`sha256:${path.basename(movedLayout)}`)) await rm(movedLayout, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}
export async function rotateLogs(): Promise<void> {
  for (const folder of ['logs', 'evidence']) {
    const dir = path.join(home, folder);
    if (!await exists(dir)) continue;
    for (const file of await readdir(dir)) if (!(folder === 'logs' && file === 'manager.log') && Date.now() - (await stat(path.join(dir, file))).mtimeMs > 7 * 86400_000) await rm(path.join(dir, file));
  }
}
