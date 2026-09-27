#!/usr/bin/env node
/**
 * Private repos default to a contents-only GITHUB_TOKEN; v2 change detection also reads PRs.
 * Draft updates skip browser tests, so becoming ready must trigger them. Add explicit reads
 * and ready_for_review to app-owned thin CI callers, preserving other permissions/triggers.
 * Run from the app root: node platform/tooling/codemods/v2-ci-callers.ts [--check] [ROOT].
 * Idempotent. --check writes nothing and exits 1 when changes are needed. Explicit denials or
 * complex YAML need manual review. Inspect every file before writing any changes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export function transform(source: string): string {
  const existing = /^permissions:([^\n]*)\n((?:[ \t]+[^\n]*\n|\n)*)/m.exec(source);
  if (!existing) {
    if (!/^jobs:\s*$/m.test(source)) throw Error("Review the custom CI jobs mapping manually");
    source = source.replace(/^jobs:\s*$/m, "permissions:\n  contents: read\n  pull-requests: read\n\njobs:");
  } else if (!["read-all", "write-all"].includes(existing[1].trim())) {
    if (existing[1].trim() && !existing[1].trim().startsWith("#")) throw Error("Review custom CI permission expressions manually");
    const values = new Map<string, string>();
    for (const line of existing[2].split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const row = /^ {2}([a-z-]+): (read|write|none)\s*(?:#.*)?$/.exec(line);
      if (!row || values.has(row[1])) throw Error("Review complex or duplicate CI permissions manually");
      values.set(row[1], row[2]);
    }
    const added: string[] = [];
    for (const name of ["contents", "pull-requests"]) {
      if (values.get(name) === "none") throw Error("CI explicitly denies " + name + "; review manually");
      if (!values.has(name)) added.push("  " + name + ": read");
    }
    if (added.length) source = source.slice(0, existing.index) + existing[0].trimEnd() + "\n" + added.join("\n") + "\n\n" + source.slice(existing.index + existing[0].length);
  }
  const trigger = /^ {2}pull_request:\s*\n((?: {4}[^\n]*\n|\n)*)/m.exec(source);
  if (!trigger) throw Error("Review the custom pull_request trigger manually");
  const types = /^ {4}types: \[([^\]]*)\]\s*$/m.exec(trigger[1]);
  let body = trigger[1];
  if (types) {
    const values = types[1].split(",").map(value => value.trim());
    if (values.some(value => !/^[a-z_]+$/.test(value))) throw Error("Review custom pull_request types manually");
    if (!values.includes("ready_for_review")) body = body.replace(types[0], "    types: [" + [...values, "ready_for_review"].join(", ") + "]");
  } else {
    if (/^ {4}types:/m.test(body)) throw Error("Review complex pull_request types manually");
    body = "    types: [opened, synchronize, reopened, ready_for_review]\n" + body;
  }
  return source.slice(0, trigger.index) + "  pull_request:\n" + body + source.slice(trigger.index + trigger[0].length);
}
export function migrate(root: string, check = false): string[] {
  const directory = path.join(root, ".github/workflows");
  if (!fs.existsSync(directory)) return [];
  const changes: { relative: string; file: string; content: string }[] = [];
  for (const name of fs.readdirSync(directory).filter(file => /^ci-[a-z-]+\.ya?ml$/.test(file))) {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error("CI caller must be a regular file: " + name);
    const source = fs.readFileSync(file, "utf8");
    if (!/^\s+uses: \.\/\.github\/workflows\/platform-ci-[a-z-]+\.ya?ml\s*$/m.test(source)) continue;
    if (!/^ {2}pull_request:/m.test(source)) continue; // Manual exact-commit verification has no PR event.
    const content = transform(source);
    if (content !== source) changes.push({ relative: ".github/workflows/" + name, file, content });
  }
  if (!check) for (const change of changes) fs.writeFileSync(change.file, change.content);
  return changes.map(row => row.relative);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v2-ci-callers.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need migration" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
