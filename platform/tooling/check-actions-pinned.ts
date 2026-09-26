// Every third-party GitHub Action is pinned to a full commit SHA. Some accounts refuse
// unpinned actions, and a tag can be moved to different code.
// Usage: ./platform/tooling/node-ts.sh platform/tooling/check-actions-pinned.ts [ROOT]
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/;

export function unpinnedUses(text: string): { line: number; uses: string }[] {
  const found: { line: number; uses: string }[] = [];
  text.split("\n").forEach((raw, index) => {
    const match = raw.match(/^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/);
    if (!match) return;
    const uses = match[1];
    if (uses.startsWith("./") || /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(uses) || PINNED.test(uses)) return;
    found.push({ line: index + 1, uses });
  });
  return found;
}

export function workflowFiles(root: string): string[] {
  const files: string[] = [];
  const workflows = path.join(root, ".github/workflows");
  if (existsSync(workflows)) {
    for (const name of readdirSync(workflows)) if (/\.ya?ml$/.test(name)) files.push(path.join(".github/workflows", name));
  }
  const actions = path.join(root, ".github/actions");
  if (existsSync(actions)) {
    for (const name of readdirSync(actions)) {
      for (const file of ["action.yml", "action.yaml"]) {
        if (existsSync(path.join(actions, name, file))) files.push(path.join(".github/actions", name, file));
      }
    }
  }
  return files.sort();
}

export function main(argv: readonly string[], out: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): number {
  const root = path.resolve(argv[0] ?? ".");
  let problems = 0;
  for (const file of workflowFiles(root)) {
    for (const { line, uses } of unpinnedUses(readFileSync(path.join(root, file), "utf8"))) {
      out(`${file}:${line}: "${uses}" is not pinned to a full commit SHA (use owner/repo@<40-hex> # vX.Y.Z)`);
      problems++;
    }
  }
  out(problems === 0 ? "Every action is pinned to a commit SHA." : `check-actions-pinned: ${problems} problem(s)`);
  return problems === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
