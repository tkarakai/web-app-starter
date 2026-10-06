#!/usr/bin/env node
/**
 * Turbo 2.11 writes version-matched agent guidance before repository-scoped commands when an AI
 * agent is detected. Add its managed block during the upgrade so the later verification commands
 * cannot create an unexpected app-owned AGENTS.md edit and stop the upgrade after tests pass.
 *
 * Run from the app root:
 * ./platform/tooling/node-ts.sh platform/tooling/codemods/v4-turbo-agent-guidance.ts [--check] [ROOT]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { openMigrationFile } from "./open-migration-file.ts";

const FILE = "AGENTS.md";
const BEGIN = "<!-- BEGIN:turborepo-agent-rules -->";
const END = "<!-- END:turborepo-agent-rules -->";
const BLOCK = `${BEGIN}

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the \`turbo\` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run \`node -p "require.resolve('turbo/package.json')"\` from a workspace that depends on \`turbo\`.

Read \`docs/README.md\` inside that installed package first, then read the relevant pages from its \`docs/\` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by \`turbo\` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in \`crates/turborepo-cli/src/cli/agent_guidance.rs\`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set \`"agentGuidance": false\` in the root \`turbo.json\` or \`turbo.jsonc\` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
${END}`;

export function migrateContent(content: string): string {
  const starts = [...content.matchAll(new RegExp(BEGIN, "g"))];
  const ends = [...content.matchAll(new RegExp(END, "g"))];
  if (starts.length || ends.length) {
    if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
      throw Error("Malformed Turbo agent guidance markers in AGENTS.md");
    }
    return content.slice(0, starts[0].index) + BLOCK + content.slice(ends[0].index + END.length);
  }
  const separator = content.length === 0 || content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${separator}${BLOCK}\n`;
}

export function migrate(root: string, check = false): string[] {
  const target = path.join(root, FILE);
  let fd = openMigrationFile(root, FILE, check);
  if (fd === undefined) {
    if (check) return [FILE];
    fd = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o666);
  }
  try {
    const before = fs.readFileSync(fd, "utf8");
    const after = migrateContent(before);
    if (after === before) return [];
    if (!check) {
      const bytes = Buffer.from(after, "utf8");
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      fs.ftruncateSync(fd, bytes.length);
    }
    return [FILE];
  } finally {
    fs.closeSync(fd);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v4-turbo-agent-guidance.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need migration" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
