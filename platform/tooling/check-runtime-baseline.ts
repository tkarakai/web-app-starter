// Verify every place that names the Node or Bun runtime agrees with the baseline.
// Usage: ./scripts/node-ts.sh scripts/check-runtime-baseline.ts [ROOT]
// Policy and the list of locations: platform/docs/dependency-migrations.md#runtime-baseline
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Manifest = {
  packageManager?: string;
  engines?: { node?: string };
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const setupAction = ".github/actions/setup-bun/action.yml";
const workflowDir = ".github/workflows";
const dockerDir = "infra/aws/docker";

function readManifest(file: string): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

function major(version: string): string | undefined {
  return version.match(/(\d+)/)?.[1];
}

function workspaceManifests(root: string, globs: string[]): string[] {
  const files: string[] = [];
  for (const glob of globs) {
    if (!glob.endsWith("/*")) throw new Error(`unsupported workspace glob: ${glob}`);
    const dir = path.join(root, glob.slice(0, -2));
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(file)) files.push(file);
    }
  }
  return files.sort();
}

function actionDefault(text: string, input: string): string | undefined {
  const block = text.match(new RegExp(`^  ${input}:\\n((?:    .*\\n)+)`, "m"))?.[1];
  return block?.match(/^ {4}default: "?([^"\n]+)"?$/m)?.[1];
}

export function checkRuntimeBaseline(root: string): string[] {
  const errors: string[] = [];
  const nodeFile = path.join(root, ".node-version");
  if (!existsSync(nodeFile)) return [".node-version is missing"];
  const node = readFileSync(nodeFile, "utf8").trim();
  if (!/^\d+$/.test(node)) errors.push(`.node-version must be a bare major, found "${node}"`);

  const rootManifest = readManifest(path.join(root, "package.json"));
  if (rootManifest.engines?.node !== `${node}.x`) {
    errors.push(`package.json engines.node is "${rootManifest.engines?.node}", expected "${node}.x"`);
  }

  const action = readFileSync(path.join(root, setupAction), "utf8");
  const actionNode = actionDefault(action, "node-version");
  if (actionNode !== node) errors.push(`${setupAction} node-version default is "${actionNode}", expected "${node}"`);

  const bun = rootManifest.packageManager?.match(/^bun@(.+)$/)?.[1];
  const actionBun = actionDefault(action, "bun-version");
  if (!bun) errors.push(`package.json packageManager is "${rootManifest.packageManager}", expected bun@<version>`);
  else if (actionBun !== bun) errors.push(`${setupAction} bun-version default is "${actionBun}", expected "${bun}"`);

  const workflows = path.join(root, workflowDir);
  for (const file of existsSync(workflows) ? readdirSync(workflows).sort() : []) {
    const text = readFileSync(path.join(workflows, file), "utf8");
    for (const [, value] of text.matchAll(/node-version:\s*["']?([^"'\s#]+)/g)) {
      if (major(value) !== node) errors.push(`${workflowDir}/${file} sets node-version "${value}", expected "${node}"`);
    }
  }

  const dockerfiles = path.join(root, dockerDir);
  for (const file of existsSync(dockerfiles) ? readdirSync(dockerfiles).filter((f) => f.endsWith("Dockerfile")).sort() : []) {
    const text = readFileSync(path.join(dockerfiles, file), "utf8");
    const dockerNode = text.match(/^ARG NODE_VERSION=(\S+)/m)?.[1];
    const dockerBun = text.match(/^ARG BUN_VERSION=(\S+)/m)?.[1];
    if (dockerNode !== node) errors.push(`${dockerDir}/${file} NODE_VERSION is "${dockerNode}", expected "${node}"`);
    if (bun && dockerBun !== bun) errors.push(`${dockerDir}/${file} BUN_VERSION is "${dockerBun}", expected "${bun}"`);
  }

  const manifests = [path.join(root, "package.json"), ...workspaceManifests(root, rootManifest.workspaces ?? [])];
  for (const file of manifests) {
    const manifest = readManifest(file);
    const types = manifest.devDependencies?.["@types/node"] ?? manifest.dependencies?.["@types/node"];
    if (types && major(types) !== node) {
      errors.push(`${path.relative(root, file)} has @types/node "${types}", expected major ${node}`);
    }
  }
  return errors;
}

export function main(args: string[]): number {
  const root = path.resolve(args[0] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const errors = checkRuntimeBaseline(root);
  if (errors.length === 0) {
    process.stdout.write("Runtime baseline is consistent.\n");
    return 0;
  }
  process.stderr.write(
    `Runtime baseline mismatch (see platform/docs/dependency-migrations.md#runtime-baseline):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  return 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
