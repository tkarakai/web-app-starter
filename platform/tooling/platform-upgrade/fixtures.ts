import { afterEach } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createCache } from "./git.ts";
import { createPlan } from "./plan.ts";
import { MANIFEST, ADVISORIES, ENTRY, type Manifest, type Release } from "./metadata.ts";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
export function temp(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-plan-")); roots.push(root); return root; }
export function write(root: string, file: string, content: string): void { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); }
export function git(root: string, ...args: string[]): string { return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function release(version: string, previous: string | null): Release { return { version, previous, supportedBaseline: ">=2.0.0 <3.0.0", codemods: [], migrations: [], env: [], removedFiles: [], renamedExports: [], dependencyFloors: [], changedSeams: [] }; }
export function fixture() {
  const source = temp(); git(source, "init", "-q");
  const manifest: Manifest = { schemaVersion: 1, runtime: { nodeMajor: 24, bun: "1.4.2" }, seams: [{ id: "config", path: "app.config.ts", hooks: ["export"] }, { id: "package", path: "package.json", hooks: [] }], releases: [release("2.0.0", null)] };
  write(source, MANIFEST, JSON.stringify(manifest)); write(source, ADVISORIES, '{"schemaVersion":1,"advisories":[]}'); write(source, ENTRY, "throw new Error('planner must not execute target code');\n");
  write(source, "platform/VERSION", "2.0.0\n"); write(source, "platform/feature.ts", "export const feature = 'old';\n"); write(source, "platform/obsolete.ts", "old\n");
  write(source, "app.config.ts", "export const brand = 'starter';\n\n// Keep this separator.\n\nexport const mode = 'old';\n");
  write(source, "package.json", '{"name":"app","dependencies":{"example":"^2.0.0"}}\n'); write(source, ".gitignore", ".env.local\n");
  git(source, "add", "-A"); git(source, "commit", "-qm", "baseline"); git(source, "tag", "v2.0.0"); const commit = git(source, "rev-parse", "HEAD");
  const app = temp(); git(app, "clone", "-q", source, ".");
  write(app, ".platform-base.json", JSON.stringify({ version: "2.0.0", commit, patches: [] }));
  write(app, "app.config.ts", fs.readFileSync(path.join(app, "app.config.ts"), "utf8").replace("'starter'", "'my business'"));
  write(app, "apps/web/business.ts", "export const total = 42;\n"); write(app, ".env.local", "TOKEN=secret-fixture-value\n");
  git(app, "add", "-A"); git(app, "commit", "-qm", "adopt and customize");
  function publish(next: string, edit?: (entry: Release) => void) {
    const entry = release(next, manifest.releases.at(-1)!.version); edit?.(entry); manifest.releases.push(entry);
    write(source, MANIFEST, JSON.stringify(manifest)); write(source, "platform/VERSION", next + "\n");
    git(source, "add", "-A"); git(source, "commit", "-qm", "release " + next); git(source, "tag", "v" + next);
  }
  function plan(to: string) {
    const cache = createCache({ kind: "local", path: source }); roots.push(cache.directory);
    return createPlan({ root: app, source: { kind: "local", path: source }, to, cache });
  }
  return { source, app, manifest, commit, publish, plan };
}
