import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { parseBase, type PlatformBase } from "../check-zone.ts";
import { ADVISORIES, canonical, demand, digest, parseAdvisories, safeRelative, type Advisory, type Codemod, type DependencyFloor, type EnvChange, type Migration } from "./metadata.ts";
import { createCache, fileAt, fullCommit, git, gitText, loadRelease, readBlob, tree, type ReleaseSource, type Source, type SourceCache, type TreeFile } from "./git.ts";
import { readRegular } from "./io.ts";
import { isZonePath, secretValueFile } from "./ownership.ts";
import { compare, raiseFloor, satisfies, version } from "./semver.ts";
import { scanEnvironment, type EnvScan } from "./env.ts";

export type Gate = { id: string; kind: "patch" | "unrecorded-zone" | "seam-conflict" | "removed-env" | "dynamic-env" | "new-secret" | "dependency" | "advisory" | "migration"; message: string; files: string[]; beforeApply: boolean };
export type Change = { path: string; kind: "platform" | "seam" | "dependency"; action: "add" | "change" | "delete"; conflict: boolean };
export type PlannedPatch = { path: string; reason: string; absorbed: boolean; baseToApp: string; appToTarget: string };
export type FloorPlan = DependencyFloor & { ranges: { section: string; before: string; after?: string; reason?: string }[] };
export type Plan = {
  schemaVersion: 1; tool: "platform-upgrade"; digest: string;
  app: { root: string; head: string; branch: string; fingerprint: string };
  source: Source; installed: PlatformBase; previousBaseHash: string;
  target: { version: string; commit: string; manifestDigest: string; nodeMajor: number; bun: string };
  releases: { version: string; commit: string }[];
  changes: Change[]; patches: PlannedPatch[]; earlyCommits: string[];
  codemods: (Codemod & { release: string })[]; migrations: Migration[];
  environment: { changes: EnvChange[]; scan: EnvScan }; dependencies: FloorPlan[];
  advisorySource?: { version: string; commit: string; digest: string };
  advisories: Advisory[]; removedFiles: string[]; renamedExports: { from: string; to: string }[];
  gates: Gate[]; rollback: string;
};
export type Payload = { path: string; mode: TreeFile["mode"]; content: Buffer } | { path: string; remove: true };
export type Planned = { plan: Plan; cache: SourceCache; baseline: ReleaseSource; target: ReleaseSource; payloads: Payload[] };

export function workingFiles(root: string, excluded: string[] = []): Record<string, string> {
  const files = git(root, ["ls-files", "-cz", "--others", "--exclude-standard"]).toString("utf8").split("\0").filter(Boolean);
  const hashes: Record<string, string> = Object.create(null);
  for (const file of [...new Set(files)].sort()) {
    if (excluded.includes(file)) continue;
    safeRelative(file);
    const full = path.join(root, file);
    let stat: fs.Stats; try { stat = fs.lstatSync(full); } catch (error) { if ((error as { code?: string }).code === "ENOENT") { hashes[file] = "deleted"; continue; } throw error; }
    demand(stat.isFile() || stat.isSymbolicLink(), "Unsupported working-tree file: " + file);
    const regular = stat.isSymbolicLink() ? undefined : readRegular(full);
    const mode = regular ? regular.stat.mode & 0o111 ? "100755" : "100644" : "120000";
    const bytes = regular ? regular.content : Buffer.from(fs.readlinkSync(full));
    hashes[file] = mode + ":" + digest(bytes);
  }
  return hashes;
}
export function dirtyPaths(root: string, excluded: string[] = []): string[] {
  return git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).toString("utf8").split("\0").filter(Boolean).map(row => /^[ MADRCU?!]{2} /.test(row) ? row.slice(3) : row).filter(file => !excluded.includes(file));
}
function entry(entries: TreeFile[], file: string): TreeFile | undefined { return entries.find(row => row.path === file); }
function bytes(repo: string, value?: TreeFile): Buffer | undefined { return value ? readBlob(repo, value.blob) : undefined; }
function same(a?: TreeFile, b?: TreeFile): boolean { return a?.blob === b?.blob && a?.mode === b?.mode; }
function active(seam: { optionalApp?: string }, files: TreeFile[]): boolean { return !seam.optionalApp || files.some(file => file.path.startsWith(seam.optionalApp + "/")); }
function mergeText(directory: string, file: string, base?: Buffer, app?: Buffer, target?: Buffer): { content: Buffer; conflict: boolean } {
  demand(![base, app, target].some(value => value?.includes(0)), "Binary seam needs manual migration: " + file);
  const key = digest(file), names = ["app", "base", "target"].map(side => path.join(directory, key + "." + side));
  for (const [index, content] of [app, base, target].entries()) fs.writeFileSync(names[index], content ?? "", { mode: 0o600 });
  const result = spawnSync("git", ["merge-file", "--diff3", "-p", "-L", "app", "-L", "installed platform", "-L", "target platform", ...names], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  demand(!result.error && result.status !== null && result.status >= 0 && result.status < 128, "Could not merge seam: " + file);
  return { content: result.stdout, conflict: result.status !== 0 };
}
function patchDiff(directory: string, file: string, before?: Buffer, after?: Buffer): string {
  if (secretValueFile(file)) return "Diff omitted for a secret-value file; inspect locally.";
  const key = digest(file + String(before?.length) + String(after?.length));
  const left = path.join(directory, key + ".before"), right = path.join(directory, key + ".after");
  fs.writeFileSync(left, before ?? "", { mode: 0o600 }); fs.writeFileSync(right, after ?? "", { mode: 0o600 });
  const result = spawnSync("git", ["diff", "--no-index", "--no-ext-diff", "--", left, right], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  demand(!result.error && (result.status === 0 || result.status === 1), "Cannot inspect patch: " + file);
  return result.stdout.replaceAll(left, "before/" + file).replaceAll(right, "after/" + file).slice(0, 65536);
}
export async function createPlan(options: { root: string; source: Source; to: string; advisoryRelease?: string; excluded?: string[]; cache?: SourceCache; identity?: { root: string; branch: string } }): Promise<Planned> {
  const root = fs.realpathSync(options.root), excluded = options.excluded ?? [];
  version(options.to);
  demand(dirtyPaths(root, excluded).length === 0, "Commit or stash app changes before planning an upgrade");
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
    const full = gitText(root, ["rev-parse", "--git-path", marker]); demand(!fs.existsSync(path.resolve(root, full)), "Finish the active Git operation before upgrading");
  }
  const baseText = fs.readFileSync(path.join(root, ".platform-base.json"), "utf8"), installed = parseBase(baseText);
  demand(typeof installed !== "string", typeof installed === "string" ? installed : "Invalid baseline"); version(installed.version);
  demand(compare(options.to, installed.version) >= 0, "Platform downgrades are not supported; use a reviewed revert");
  const cache = options.cache ?? createCache(options.source);
  const target = await loadRelease(cache, options.to), baseline = await loadRelease(cache, installed.version);
  // Wholesale upgrades do not put release commits in the app's ancestry. A fresh clone
  // therefore resolves recorded upstream identities in the trusted release cache.
  demand(baseline.commit.startsWith(installed.commit), "Installed version/commit does not match the trusted release tag");
  installed.commit = fullCommit(cache.repo, installed.commit);
  demand(baseline.commit === installed.commit, "Installed version/commit does not match the trusted release tag");
  const baseIndex = target.manifest.releases.findIndex(row => row.version === installed.version); demand(baseIndex >= 0, "Target has no history for the installed baseline");
  const selected = target.manifest.releases.slice(baseIndex + 1);
  const advertised = cache.tags.filter(tag => compare(tag, installed.version) > 0 && compare(tag, options.to) <= 0);
  demand(canonical(advertised) === canonical(selected.map(row => row.version)), "Release history and source tags disagree; an intermediate release is missing");
  let previous = installed.version;
  const sources: ReleaseSource[] = [];
  for (const release of selected) {
    demand(release.previous === previous && satisfies(previous, release.supportedBaseline), "Unsupported intermediate baseline for " + release.version);
    const source = await loadRelease(cache, release.version);
    demand(canonical(source.manifest.releases.at(-1)) === canonical(release), "Historical release definition changed: " + release.version);
    sources.push(source); previous = release.version;
  }
  const head = gitText(root, ["rev-parse", "HEAD"]), appTree = tree(root, head);
  const patches: PlannedPatch[] = [], gates: Gate[] = [], changes: Change[] = [], payloads: Payload[] = [];
  const mergeDir = path.join(cache.directory, "merges"); fs.mkdirSync(mergeDir, { recursive: true });
  const gate = (id: string, kind: Gate["kind"], message: string, files: string[], beforeApply = true) => { if (!gates.some(row => row.id === id)) gates.push({ id, kind, message, files, beforeApply }); };
  const change = (file: string, kind: Change["kind"], current: TreeFile | undefined, next: Payload, conflict = false): void => {
    changes.push({ path: file, kind, action: "remove" in next ? "delete" : current ? "change" : "add", conflict }); payloads.push(next);
  };
  const earlyCommits = (installed.earlyCommits ?? []).map(commit => fullCommit(cache.repo, commit));
  const earlyFiles = new Map<string, TreeFile | undefined>();
  for (const commit of earlyCommits) {
    // Only a recorded upstream commit reachable from this trusted release is absorbed.
    demand(spawnSync("git", ["merge-base", "--is-ancestor", commit, target.commit], { cwd: cache.repo }).status === 0, "Recorded early commit is not part of the target release: " + commit);
    for (const file of gitText(cache.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit]).split("\n").filter(Boolean)) if (isZonePath(file)) earlyFiles.set(file, entry(tree(cache.repo, commit), file));
  }
  const zoneFiles = [...new Set([...baseline.tree, ...appTree, ...target.tree].map(row => row.path).filter(isZonePath))].sort();
  for (const file of zoneFiles) {
    const base = entry(baseline.tree, file), app = entry(appTree, file), next = entry(target.tree, file);
    const recorded = installed.patches.find(patch => patch.path === file);
    if (recorded) {
      const absorbed = same(app, next);
      patches.push({ ...recorded, absorbed, baseToApp: patchDiff(mergeDir, file, bytes(cache.repo, base), bytes(root, app)), appToTarget: patchDiff(mergeDir, file, bytes(root, app), bytes(cache.repo, next)) });
      if (!absorbed) gate("patch:" + file, "patch", "Inspect the patch, then accept the release or reapply a recorded patch: " + file, [file]);
    } else if (!same(base, app) && !same(app, next) && !(earlyFiles.has(file) && same(earlyFiles.get(file), app))) gate("zone:" + file, "unrecorded-zone", "Unrecorded platform edits require a patch record before upgrading: " + file, [file]);
    if (!same(app, next)) change(file, "platform", app, next ? { path: file, mode: next.mode, content: readBlob(cache.repo, next.blob) } : { path: file, remove: true });
  }
  for (const patch of installed.patches) demand(isZonePath(patch.path) && zoneFiles.includes(patch.path), "Invalid or missing patch path: " + patch.path);
  for (const seam of target.manifest.seams.filter(seam => active(seam, appTree))) {
    const file = seam.path, base = entry(baseline.tree, file), app = entry(appTree, file), next = entry(target.tree, file);
    demand(next, "Target is missing required seam: " + file);
    demand(next.mode !== "120000" && app?.mode !== "120000" && base?.mode !== "120000", "Symlink seams are unsupported: " + file);
    if (!app && base) {
      gate("seam:" + file, "seam-conflict", "A required seam was deleted in the app; review restoring it: " + file, [file]);
      change(file, "seam", app, { path: file, mode: next.mode, content: readBlob(cache.repo, next.blob) }, true);
      continue;
    }
    if (same(app, next) || same(base, next)) continue;
    if (same(base, app)) change(file, "seam", app, { path: file, mode: next.mode, content: readBlob(cache.repo, next.blob) });
    else {
      const merged = mergeText(mergeDir, file, bytes(cache.repo, base), bytes(root, app), bytes(cache.repo, next));
      if (merged.conflict || !app) gate("seam:" + file, "seam-conflict", "Resolve the three-way seam conflict: " + file, [file], false);
      change(file, "seam", app, { path: file, mode: app?.mode ?? next.mode, content: merged.content }, merged.conflict || !app);
    }
  }
  const codemods: Plan["codemods"] = [], migrations: Migration[] = [];
  for (const release of selected) {
    const source = sources.find(row => row.version === release.version)!;
    for (const codemod of release.codemods) if (!codemods.some(row => row.id === codemod.id)) { fileAt(cache.repo, source.tree, codemod.path); codemods.push({ ...codemod, release: release.version }); }
    for (const migration of release.migrations) if (!migrations.some(row => row.id === migration.id)) { fileAt(cache.repo, source.tree, migration.instructions); migrations.push(migration); }
  }
  const migrationIds = new Set<string>();
  for (const migration of migrations) {
    demand(migration.dependsOn.every(id => migrationIds.has(id) || target.manifest.releases.slice(0, baseIndex + 1).some(row => row.migrations.some(item => item.id === id))), "Missing/out-of-order migration dependency: " + migration.id);
    migrationIds.add(migration.id);
    if (migration.changesRows) gate("migration:" + migration.id, "migration", "Record deployment-specific approval and verified migration completion: " + migration.id, []);
  }
  const envChanges = selected.flatMap(row => row.env);
  const scan = scanEnvironment(appTree.filter(row => row.mode !== "120000").map(row => ({ path: row.path, content: readBlob(root, row.blob) })));
  for (const env of envChanges) {
    if (env.kind === "new" && env.secret && env.required) gate("secret:" + env.name, "new-secret", "Configure the new secret outside Git before verification: " + env.name, []);
    const references = scan.references.filter(row => row.name === env.name);
    if (env.kind !== "new" && references.length) gate("env:" + env.name, "removed-env", "App code/declarations still reference " + env.kind + " env " + env.name, [...new Set(references.map(row => row.file))]);
  }
  if (envChanges.some(env => env.kind !== "new" || env.required) && scan.dynamic.length) gate("env:dynamic", "dynamic-env", "Review dynamic env accesses; static scanning cannot establish their names", [...new Set(scan.dynamic.map(row => row.file))]);
  const dependencies: FloorPlan[] = [];
  const floors = new Map<string, DependencyFloor>();
  const addFloor = (floor: DependencyFloor) => { const key = floor.path + ":" + floor.name; const old = floors.get(key); if (!old || compare(floor.minimum, old.minimum) > 0) floors.set(key, floor); };
  for (const release of selected) for (const floor of release.dependencyFloors.filter(row => active(row, appTree))) addFloor(floor);
  const rootPackage = entry(appTree, "package.json");
  if (rootPackage) {
    const overrides = (JSON.parse(readBlob(root, rootPackage.blob).toString("utf8")) as { overrides?: Record<string, unknown> }).overrides;
    for (const floor of [...floors.values()]) if (floor.path !== "package.json" && overrides && Object.hasOwn(overrides, floor.name)) addFloor({ path: "package.json", name: floor.name, minimum: floor.minimum });
  }
  for (const floor of floors.values()) {
    demand(!isZonePath(floor.path), "Dependency floors cannot edit platform packages");
    const existing = payloads.find(row => row.path === floor.path), app = entry(appTree, floor.path);
    demand(app || existing, "Required dependency manifest is missing: " + floor.path);
    if (changes.some(row => row.path === floor.path && row.conflict)) {
      gate("dependency:" + floor.path + ":" + floor.name, "dependency", "Resolve the package seam before checking its dependency floor", [floor.path], false);
      // Text ranges are unreadable until review, but the installed dependency
      // must still meet this minimum after the reviewer resolves the conflict.
      dependencies.push({ ...floor, ranges: [] });
      continue;
    }
    const content = existing && !("remove" in existing) ? existing.content : readBlob(root, app!.blob);
    const pkg = JSON.parse(content.toString("utf8")) as Record<string, Record<string, string> | undefined>;
    const ranges: FloorPlan["ranges"] = [];
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides"]) {
      const values = pkg[section];
      const before = values && Object.hasOwn(values, floor.name) ? values[floor.name] : undefined; if (before === undefined) continue;
      demand(typeof before === "string", "Unsupported dependency declaration for " + floor.name);
      const result = raiseFloor(before, floor.minimum); ranges.push({ section, before, after: result.value, reason: result.reason });
      if (result.reason) gate("dependency:" + floor.path + ":" + floor.name + ":" + section, "dependency", floor.name + ": " + result.reason, [floor.path]);
      else if (result.value) pkg[section]![floor.name] = result.value;
    }
    if (!ranges.length) gate("dependency:" + floor.path + ":" + floor.name, "dependency", "The required dependency is not declared: " + floor.name, [floor.path]);
    if (ranges.some(row => row.after && row.before !== row.after)) {
      const next = { path: floor.path, mode: app?.mode ?? "100644" as const, content: Buffer.from(JSON.stringify(pkg, null, 2) + "\n") };
      if (existing) payloads[payloads.indexOf(existing)] = next;
      else change(floor.path, "dependency", app, next);
    }
    dependencies.push({ ...floor, ranges });
  }
  const allAdvisories = new Map(parseAdvisories(fileAt(cache.repo, target.tree, ADVISORIES).toString("utf8")).advisories.map(row => [row.id, row]));
  let advisorySource: Plan["advisorySource"];
  if (options.advisoryRelease) {
    const latest = await loadRelease(cache, options.advisoryRelease), bytes = fileAt(cache.repo, latest.tree, ADVISORIES);
    advisorySource = { version: latest.version, commit: latest.commit, digest: digest(bytes) };
    for (const advisory of parseAdvisories(bytes.toString("utf8")).advisories) allAdvisories.set(advisory.id, advisory);
  }
  const advisories = [...allAdvisories.values()].filter(row => satisfies(installed.version, row.affected));
  for (const advisory of advisories) if (["high", "critical"].includes(advisory.severity)) gate("advisory:" + advisory.id, "advisory", advisory.severity + " advisory requires review and passing contracts: " + advisory.id, []);
  const unsigned = {
    schemaVersion: 1 as const, tool: "platform-upgrade" as const,
    app: { root: options.identity?.root ?? root, head, branch: options.identity?.branch ?? gitText(root, ["branch", "--show-current"]), fingerprint: digest(canonical(workingFiles(root, excluded))) },
    source: options.source, installed, previousBaseHash: digest(baseText),
    target: { version: target.version, commit: target.commit, manifestDigest: target.manifestDigest, nodeMajor: target.manifest.runtime.nodeMajor, bun: target.manifest.runtime.bun },
    releases: sources.map(row => ({ version: row.version, commit: row.commit })), changes, patches, earlyCommits, codemods, migrations,
    environment: { changes: envChanges, scan }, dependencies, advisories, ...(advisorySource ? { advisorySource } : {}),
    removedFiles: selected.flatMap(row => row.removedFiles), renamedExports: selected.flatMap(row => row.renamedExports), gates,
    rollback: "Before data changes: abandon the update branch or revert with an ordinary commit, including baseline and lockfile. After data changes: follow the migration recovery procedure; a source revert is not a data rollback.",
  };
  return { plan: { ...unsigned, digest: digest(canonical(unsigned)) }, cache, baseline, target, payloads };
}
