#!/usr/bin/env node
/** v4's reference apps extracted an app-owned @repo/onboarding workspace.
 * Upgrades preserve app source, so older apps must not inherit a dependency on
 * a workspace they never adopted. Remove only the reference dependency/config
 * when packages/onboarding is absent. Existing custom packages remain untouched.
 * Run from the app root: node platform/tooling/codemods/v4-onboarding-dependency.ts [--check] [ROOT].
 * Dependency-free, idempotent; --check reports changes without writing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { openMigrationFile } from "./open-migration-file.ts";

export function migrate(root: string, check = false): string[] {
  // lstat also preserves a customized symlink; never follow it or replace its contents.
  try { fs.lstatSync(path.join(root, "packages/onboarding")); return []; }
  catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  const changes: { relative: string; fd: number; content: string }[] = [];
  const opened: number[] = [];
  try {
    for (const app of ["web", "landing"]) {
      for (const name of ["package.json", "next.config.ts"]) {
        const relative = `apps/${app}/${name}`;
        const fd = openMigrationFile(root, relative, check);
        if (fd === undefined) continue;
        opened.push(fd);
        const source = fs.readFileSync(fd, "utf8");
        let content = source;
        if (name === "package.json") {
          const manifest = JSON.parse(source) as { dependencies?: Record<string, unknown> };
          if (manifest.dependencies?.["@repo/onboarding"] !== "workspace:*") continue;
          delete manifest.dependencies["@repo/onboarding"];
          content = JSON.stringify(manifest, null, 2) + "\n";
        } else {
          // Only the standard literal transpilePackages array; custom expressions need review.
          content = source.replace(/(transpilePackages\s*:\s*\[)([^\]]*)(\])/g, (match, start: string, entries: string, end: string) => {
            const values = entries.split(",");
            // Leave custom expressions and escaped literals for manual review.
            if (!values.every(value => /^\s*(?:"[^"\\]*"|'[^'\\]*')?\s*$/.test(value))) return match;
            return start + values.filter(value => !['"@repo/onboarding"', "'@repo/onboarding'"].includes(value.trim())).join(",") + end;
          });
        }
        if (content !== source) changes.push({ relative, fd, content });
      }
    }
    // Validate every target before the first write, retaining verified descriptors.
    if (!check) for (const { fd, content } of changes) {
      fs.writeSync(fd, content, 0, "utf8"); fs.ftruncateSync(fd, Buffer.byteLength(content));
    }
    return changes.map(({ relative }) => relative);
  } finally { for (const fd of opened) fs.closeSync(fd); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v4-onboarding-dependency.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need updating" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
