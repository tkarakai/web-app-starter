/** Resolve development dependencies and binaries only inside this checkout. */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

type Manifest = { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; bin?: string | Record<string, string> };
const readManifest = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest;
function local(root: string, file: string): string {
  const actual = realpathSync(file);
  const fromRoot = relative(root, actual);
  if (fromRoot === ".." || fromRoot.startsWith(".." + sep) || resolve(root, fromRoot) !== actual) {
    throw new Error(`Dependency resolves outside this checkout: ${file} → ${actual}`);
  }
  return actual;
}
export function installedPackage(root: string, workspace: string, name: string): string {
  root = realpathSync(root);
  const manifest = local(root, join(workspace, "package.json"));
  const require = createRequire(manifest);
  for (const search of require.resolve.paths(name) ?? []) {
    const candidate = join(search, name, "package.json");
    if (existsSync(candidate)) return local(root, candidate);
  }
  throw new Error(`Missing dependency ${name} in ${workspace}`);
}
export function checkWorkspace(root: string, workspace: string): void {
  const manifest = readManifest(local(realpathSync(root), join(workspace, "package.json")));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    installedPackage(root, workspace, name);
  }
  if (manifest.dependencies?.["next-intl"] || manifest.devDependencies?.["next-intl"]) {
    local(realpathSync(root), createRequire(join(workspace, "package.json")).resolve("next-intl/plugin"));
  }
}
export function developmentBinary(root: string, workspace: string, name: string): string {
  const file = installedPackage(root, workspace, name);
  const manifest = readManifest(file);
  const binary = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[name];
  if (!binary) throw new Error(`${name} does not provide its development executable`);
  return local(realpathSync(root), resolve(dirname(file), binary));
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "check" && args.length) {
      for (const workspace of args) checkWorkspace(root, resolve(root, workspace));
    } else if (mode === "bin" && args.length === 2) {
      console.log(developmentBinary(root, resolve(root, args[0]), args[1]));
    } else throw new Error("Usage: local-dev-deps.ts check WORKSPACE... | bin WORKSPACE PACKAGE");
  } catch (error) {
    console.error(`Development dependencies: ${(error as Error).message}\nRun bun install --frozen-lockfile in this checkout before retrying.`);
    process.exitCode = 1;
  }
}
