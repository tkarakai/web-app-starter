#!/usr/bin/env node
/**
 * v3 removes the static landing app. `apps/landing` is a static export too, covers the same
 * pages, and is the one marketing site the dev launcher, CI, deployment and Ops support, so
 * keeping a second landing variant meant selection logic, separate Vercel projects and secrets
 * everywhere. The platform's static-landing CI workflow is gone, so an app-owned caller of it fails.
 *
 * This removes what remains of `apps/landing-static` in an app: the app directory, its thin CI
 * caller, its ci-verify job, its dev script, Turbo tasks, tsconfig reference and local port.
 * Move your static landing's pages, copy and assets into `apps/landing` first: the codemod
 * refuses to run while `apps/landing/package.json` is missing, and never copies content.
 * Run from the app root: ./platform/tooling/node-ts.sh platform/tooling/codemods/v3-remove-landing-static.ts [--check] [ROOT].
 * Idempotent. --check writes nothing and exits 1 when changes are needed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const APP = "landing-static";
type Change = { file: string; content?: string };

/** Drop a top-level job and its entries in other jobs' `needs` lists. */
export function removeJob(workflow: string, job: string): string {
  const name = job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return workflow
    .replace(new RegExp(`^ {2}${name}:\\n(?:(?: {4}.*)?\\n)*?(?=^ {2}\\S|(?![\\s\\S]))`, "m"), "")
    .replace(new RegExp(`(needs: \\[[^\\]]*?)(?:, ${name}(?=[,\\]])|${name}, )`, "g"), "$1");
}

/** Remove the app's local port entry from `app.config.ts`. */
export function removePort(config: string): string {
  return config.replace(/^[ \t]*["']landing-static["']\s*:\s*\d+\s*,?[ \t]*(?:\/\/[^\n]*)?\n/m, "");
}

function read(root: string, file: string): string | undefined {
  const target = path.join(root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
}

function json<T>(text: string, file: string): T {
  try { return JSON.parse(text) as T; } catch { throw Error(`Review ${file} manually: it is not plain JSON`); }
}

export function plan(root: string): Change[] {
  const changes: Change[] = [];
  const remains = [`apps/${APP}`, `.github/workflows/ci-${APP}.yml`].filter(file => fs.existsSync(path.join(root, file)));
  for (const file of remains) changes.push({ file });

  const config = read(root, "app.config.ts");
  if (config !== undefined && removePort(config) !== config) changes.push({ file: "app.config.ts", content: removePort(config) });

  const pkgText = read(root, "package.json");
  if (pkgText !== undefined) {
    const pkg = json<{ scripts?: Record<string, string> }>(pkgText, "package.json");
    if (pkg.scripts && `dev:${APP}` in pkg.scripts) {
      delete pkg.scripts[`dev:${APP}`];
      changes.push({ file: "package.json", content: `${JSON.stringify(pkg, null, 2)}\n` });
    }
  }

  const turboText = read(root, "turbo.json");
  if (turboText !== undefined) {
    const turbo = json<{ tasks?: Record<string, unknown> }>(turboText, "turbo.json");
    const tasks = Object.keys(turbo.tasks ?? {}).filter(task => task.startsWith(`@repo/${APP}#`));
    if (tasks.length) {
      for (const task of tasks) delete turbo.tasks?.[task];
      changes.push({ file: "turbo.json", content: `${JSON.stringify(turbo, null, 2)}\n` });
    }
  }

  const tsconfig = read(root, "tsconfig.json");
  if (tsconfig?.includes(`"apps/${APP}"`)) {
    const content = tsconfig.split("\n").filter(line => !line.includes(`"path": "apps/${APP}"`)).join("\n")
      .replace(/,(\s*\n\s*\])/g, "$1");
    if (content.includes(`"apps/${APP}"`)) throw Error(`Review tsconfig.json manually: apps/${APP} is referenced outside a project reference`);
    json(content, "tsconfig.json");
    changes.push({ file: "tsconfig.json", content });
  }

  const verify = read(root, ".github/workflows/ci-verify.yml");
  if (verify !== undefined) {
    const content = removeJob(verify, APP);
    if (content.includes(APP)) throw Error(`Review .github/workflows/ci-verify.yml manually: it still references ${APP}`);
    if (content !== verify) changes.push({ file: ".github/workflows/ci-verify.yml", content });
  }

  if (changes.length && !fs.existsSync(path.join(root, "apps/landing/package.json"))) {
    throw Error("apps/landing is missing. Move your static landing's pages, copy and assets into apps/landing " +
      "(start from the release's apps/landing), then rerun. Nothing was changed.");
  }
  return changes;
}

export function migrate(root: string, check = false): string[] {
  const changes = plan(root);
  if (!check) for (const change of changes) {
    const target = path.join(root, change.file);
    if (change.content === undefined) fs.rmSync(target, { recursive: true, force: true });
    else fs.writeFileSync(target, change.content);
  }
  return changes.map(change => change.content === undefined ? `${change.file} (delete)` : change.file);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v3-remove-landing-static.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need migration" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
