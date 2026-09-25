#!/usr/bin/env node
/** Read only explicit bundles; deliberately independent of upgrade.ts and its write guard. */
import { readFileSync } from "node:fs";
import { canonical, compareDependencies, parseSnapshot, type Json } from "./dependency-comparison.ts";

const HELP = `Offline dependency declaration planner (advisory only)
Usage: ./scripts/node-ts.sh scripts/starter-upgrade/dependency-plan.ts
       [--base A.json] --downstream B.json --target C.json
       --help

Inputs: schemaVersion: 1, optional claimedStarterIdentity object, and manifests
map containing root package.json and explicitly selected relative package.json paths.
No discovery, installs, network, Git, scripts, writes, apply, or baseline advancement.
Stable exact versions receive ordering annotations; all other specs remain opaque.
Compatibility and security are always not-assessed; identities are unverified claims.
stdout: deterministic JSON; stderr: JSON error on refusal.
Exit 0: complete advisory comparison (NOT compatibility passed), or help.
Exit 1: invalid arguments, unreadable/malformed input, or unsupported schema.
Exit 2: inventory-only report because --base was omitted.
See docs/dependency-planning.md for the snapshot and report contracts.
`;

export function main(argv: string[]): number {
  try {
    if (argv.length === 1 && argv[0] === "--help") { process.stdout.write(HELP); return 0; }
    const paths = new Map<string, string>();
    for (let i = 0; i < argv.length; i += 2) {
      const flag = argv[i], file = argv[i + 1];
      if (!["--base", "--downstream", "--target"].includes(flag)) throw new Error(`Unsupported argument: ${flag}`);
      if (paths.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
      if (!file || file.startsWith("--")) throw new Error(`Missing input path for ${flag}`);
      paths.set(flag, file);
    }
    if (!paths.has("--downstream") || !paths.has("--target")) throw new Error("--downstream and --target are required");
    const read = (flag: string) => parseSnapshot(readFileSync(paths.get(flag)!, "utf8"));
    const plan = compareDependencies(paths.has("--base") ? read("--base") : undefined, read("--downstream"), read("--target"));
    process.stdout.write(canonical(plan as unknown as Json) + "\n");
    return paths.has("--base") ? 0 : 2;
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: "refused", error: error instanceof Error ? error.message : String(error) }) + "\n");
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
