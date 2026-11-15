#!/usr/bin/env node
/** v5.0.0 moved the Bun baseline from 1.4.2 to 1.4.4 (`packageManager`, the `setup-bun` default).
 * `check:runtime-baseline`, a required upgrade check, also requires `ARG BUN_VERSION` in every
 * `infra/aws/docker/*Dockerfile` to match `packageManager`. Those Dockerfiles are app-owned, so the
 * upgrade does not replace them, and editing them by hand during an upgrade is refused.
 * Rewrites only an exact `ARG BUN_VERSION=1.4.2` line to `1.4.4`; any other value is the app's own
 * choice and is left for the runtime check to report.
 * Run from the app root: node platform/tooling/codemods/v5-bun-dockerfiles.ts [--check] [DOCKER_DIR].
 * DOCKER_DIR defaults to infra/aws/docker and must stay inside the app root.
 * Dependency-free, idempotent; --check reports changes without writing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { openMigrationFile } from "./open-migration-file.ts";

const FROM = "1.4.2", TO = "1.4.4";
const LINE = new RegExp(`^ARG BUN_VERSION=${FROM.replaceAll(".", "\\.")}[ \\t]*$`, "m");

/** The Dockerfile's new content, or the same string when nothing applies. */
export function migrateContent(source: string): string {
  return source.replace(LINE, `ARG BUN_VERSION=${TO}`);
}

export function migrate(root: string, check = false, directory = "infra/aws/docker"): string[] {
  const relative = path.posix.normalize(directory.split(path.sep).join("/")).replace(/\/$/, "");
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith("../")) throw Error("DOCKER_DIR must stay inside the app root");
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  if (!fs.realpathSync(absolute).startsWith(fs.realpathSync(root) + path.sep)) throw Error("DOCKER_DIR must stay inside the app root");
  const changed: string[] = [];
  for (const name of fs.readdirSync(absolute).filter(name => name.endsWith("Dockerfile")).sort()) {
    const file = relative + "/" + name;
    const fd = openMigrationFile(root, file, check);
    if (fd === undefined) continue;
    try {
      const source = fs.readFileSync(fd, "utf8");
      const content = migrateContent(source);
      if (content === source) continue;
      if (!check) { fs.writeSync(fd, content, 0, "utf8"); fs.ftruncateSync(fd, Buffer.byteLength(content)); }
      changed.push(file);
    } finally { fs.closeSync(fd); }
  }
  return changed;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v5-bun-dockerfiles.ts [--check] [DOCKER_DIR]");
    const files = migrate(process.cwd(), check, values[0]);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need updating" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
