import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ADVISORIES, ENTRY, MANIFEST, demand, digest, hasControl, parseAdvisories, parseManifest, safeRelative, type Manifest } from "./metadata.ts";
import { compare, version } from "./semver.ts";

export type Source = { kind: "github"; repo: string } | { kind: "local"; path: string };
export type TreeFile = { path: string; mode: "100644" | "100755" | "120000"; blob: string };
export type ReleaseSource = { version: string; commit: string; tree: TreeFile[]; directory: string; manifest: Manifest; manifestDigest: string };
export type SourceCache = { directory: string; repo: string; source: Source; tags: string[]; releases: Map<string, ReleaseSource> };

export function git(root: string, args: string[]): Buffer {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 });
}
export function gitText(root: string, args: string[]): string { return git(root, args).toString("utf8").trim(); }
export function resolveSource(value?: string): Source {
  if (!value) return { kind: "github", repo: "tkarakai/web-app-starter" };
  if (fs.existsSync(value)) {
    const root = fs.realpathSync(value);
    gitText(root, ["rev-parse", "--git-dir"]);
    return { kind: "local", path: root };
  }
  demand(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.startsWith("-"), "Source must be an explicit local Git repository or trusted GitHub owner/repo");
  return { kind: "github", repo: value };
}
export function sourceLocation(source: Source): string { return source.kind === "local" ? source.path : `https://github.com/${source.repo}.git`; }
export function fullCommit(root: string, ref: string): string {
  demand(/^[0-9a-f]{7,40}$/.test(ref), "Invalid commit ID");
  const commit = gitText(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  demand(/^[0-9a-f]{40}$/.test(commit), "Expected a full commit ID"); return commit;
}
const blobCache = new Map<string, Map<string, Buffer>>();
/** Batch object reads keep a whole-source plan from spawning one process per file. */
function primeBlobs(repo: string, ids: string[]): void {
  let cached = blobCache.get(repo);
  if (!cached) { if (blobCache.size >= 4) blobCache.delete(blobCache.keys().next().value!); cached = new Map(); blobCache.set(repo, cached); }
  const missing = [...new Set(ids)].filter(id => !cached.has(id));
  for (let start = 0; start < missing.length; start += 128) {
    const selected = missing.slice(start, start + 128);
    const output = execFileSync("git", ["cat-file", "--batch"], { cwd: repo, input: selected.join("\n") + "\n", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 });
    let offset = 0;
    for (const id of selected) {
      const end = output.indexOf(10, offset); demand(end >= 0, "Incomplete Git object response");
      const [actual, type, rawSize] = output.subarray(offset, end).toString("utf8").split(" "), size = Number(rawSize);
      demand(actual === id && type === "blob" && Number.isSafeInteger(size) && size >= 0 && end + 1 + size < output.length, "Invalid Git blob response");
      cached.set(id, Buffer.from(output.subarray(end + 1, end + 1 + size))); offset = end + size + 2;
    }
  }
}
export function readBlob(repo: string, blob: string): Buffer {
  demand(/^[0-9a-f]{40}$/.test(blob), "Invalid blob ID");
  const cached = blobCache.get(repo)?.get(blob); return cached ?? git(repo, ["cat-file", "blob", blob]);
}
export function tree(repo: string, commit: string): TreeFile[] {
  demand(/^[0-9a-f]{40}$/.test(commit), "Invalid tree commit");
  const rows = git(repo, ["ls-tree", "-rz", "--full-tree", commit]).toString("utf8").split("\0").filter(Boolean).map(row => {
    const tab = row.indexOf("\t"), [mode, type, blob] = row.slice(0, tab).split(" "), file = safeRelative(row.slice(tab + 1));
    demand(tab > 0 && type === "blob" && ["100644", "100755", "120000"].includes(mode), "Unsupported submodule or file mode: " + file);
    return { path: file, mode: mode as TreeFile["mode"], blob };
  });
  primeBlobs(repo, rows.map(row => row.blob));
  const folded = new Set<string>(), prefixes = new Map<string, string>();
  const paths = new Set(rows.map(row => row.path));
  for (const row of rows) {
    const lower = row.path.normalize("NFC").toLowerCase(); demand(!folded.has(lower), "Case/Unicode path collision: " + row.path); folded.add(lower);
    const parts = row.path.split("/");
    for (let i = 1; i <= parts.length; i++) { const prefix = parts.slice(0, i).join("/"), key = prefix.normalize("NFC").toLowerCase(); demand(!prefixes.has(key) || prefixes.get(key) === prefix, "Case/Unicode directory collision: " + prefix); prefixes.set(key, prefix); }
    for (let i = 1; i < parts.length; i++) demand(!paths.has(parts.slice(0, i).join("/")), "File/directory collision: " + row.path);
    if (row.mode === "120000") {
      const target = readBlob(repo, row.blob).toString("utf8");
      demand(target.length > 0 && !/[\\:]/.test(target) && !hasControl(target) && !path.posix.isAbsolute(target), "Unsafe symlink: " + row.path);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(row.path), target));
      safeRelative(resolved);
      // Resolve chains lexically, rejecting cycles and links through symlink directories.
      let current = resolved; const seen = new Set([row.path]);
      for (;;) {
        demand(!seen.has(current), "Symlink cycle: " + row.path); seen.add(current);
        const linked = rows.find(item => item.path === current);
        const parents = current.split("/");
        for (let i = 1; i < parents.length; i++) demand(!rows.some(item => item.path === parents.slice(0, i).join("/") && item.mode === "120000"), "Symlink traverses a linked directory: " + row.path);
        if (!linked || linked.mode !== "120000") break;
        const next = readBlob(repo, linked.blob).toString("utf8");
        demand(!path.posix.isAbsolute(next) && !/[\\:]/.test(next) && !hasControl(next), "Unsafe symlink chain");
        current = path.posix.normalize(path.posix.join(path.posix.dirname(current), next)); safeRelative(current);
      }
    }
  }
  return rows;
}
export function fileAt(repo: string, entries: TreeFile[], file: string): Buffer {
  const entry = entries.find(row => row.path === file); demand(entry && entry.mode !== "120000", "Missing regular release file: " + file);
  return readBlob(repo, entry.blob);
}
export function materialize(repo: string, entries: TreeFile[], directory: string): void {
  demand(!fs.existsSync(directory), "Temporary checkout already exists"); fs.mkdirSync(directory, { recursive: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.path); fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = readBlob(repo, entry.blob);
    if (entry.mode === "120000") fs.symlinkSync(bytes.toString("utf8"), target);
    else fs.writeFileSync(target, bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  }
}
export function validateSource(source: Source): void {
  demand(source && typeof source === "object" && (source.kind === "github" || source.kind === "local"), "Invalid platform source");
  if (source.kind === "github") demand(typeof source.repo === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(source.repo), "Invalid GitHub repository identifier");
  else demand(typeof source.path === "string" && path.isAbsolute(source.path) && !hasControl(source.path), "Invalid local repository path");
}
export function releaseAssetURL(source: Source, releaseVersion: string, asset: "advisories.json" | "breaking-changes.json"): string {
  validateSource(source); version(releaseVersion);
  demand(source.kind === "github", "Release attachments require a GitHub source");
  demand(asset === "advisories.json" || asset === "breaking-changes.json", "Unknown release attachment");
  return "https://github.com/" + source.repo + "/releases/download/v" + releaseVersion + "/" + asset;
}
export function createCache(source: Source): SourceCache {
  validateSource(source);
  // Node resolves module URLs through symlinks. Historical CLI entrypoint guards
  // compare that URL with argv[1], so every executable cache path must be canonical.
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "platform-upgrade-")));
  const repo = path.join(directory, "objects.git"); fs.mkdirSync(repo);
  git(repo, ["init", "--bare", "-q"]);
  const refs = gitText(repo, ["ls-remote", "--tags", "--refs", sourceLocation(source)]);
  const tags = refs.split("\n").map(row => row.split("\t")[1]).filter((ref): ref is string => !!ref && /^refs\/tags\/v\d+\.\d+\.\d+$/.test(ref)).map(ref => ref.slice("refs/tags/v".length)).sort(compare);
  return { directory, repo, source, tags, releases: new Map() };
}
export async function loadRelease(cache: SourceCache, releaseVersion: string): Promise<ReleaseSource> {
  version(releaseVersion);
  const existing = cache.releases.get(releaseVersion); if (existing) return existing;
  demand(cache.tags.includes(releaseVersion), "Missing published/local release tag: v" + releaseVersion);
  const ref = `refs/platform-upgrade/v${releaseVersion}`;
  git(cache.repo, ["fetch", "--quiet", "--no-tags", sourceLocation(cache.source), `refs/tags/v${releaseVersion}:${ref}`]);
  const commit = gitText(cache.repo, ["rev-parse", `${ref}^{commit}`]);
  const entries = tree(cache.repo, commit);
  demand(fileAt(cache.repo, entries, "platform/VERSION").toString("utf8").trim() === releaseVersion, "Tag and platform/VERSION disagree");
  const manifestBytes = fileAt(cache.repo, entries, MANIFEST);
  demand(manifestBytes.length <= 5 * 1024 * 1024, "Oversized release manifest");
  const manifest = parseManifest(manifestBytes.toString("utf8"));
  demand(manifest.releases.at(-1)?.version === releaseVersion, "Target manifest does not end at the tagged release");
  const advisoryBytes = fileAt(cache.repo, entries, ADVISORIES); demand(advisoryBytes.length <= 5 * 1024 * 1024, "Oversized advisory manifest"); parseAdvisories(advisoryBytes.toString("utf8"));
  fileAt(cache.repo, entries, ENTRY);
  if (cache.source.kind === "github") {
    for (const [name, expected] of [["breaking-changes.json", manifestBytes], ["advisories.json", advisoryBytes]] as const) {
      // Only the validated public repository identifier, semver tag and two literal asset names
      // select this request. No file body, environment value, credential or report content is sent.
      const response = await fetch(releaseAssetURL(cache.source, releaseVersion, name), { signal: AbortSignal.timeout(30000) });
      demand(response.ok, "Missing release attachment: " + name);
      const length = Number(response.headers.get("content-length") ?? 0); demand(length <= 5 * 1024 * 1024, "Oversized release attachment");
      demand(response.body, "Release attachment has no body"); const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; demand(size <= 5 * 1024 * 1024, "Oversized release attachment"); chunks.push(chunk); }
      const actual = Buffer.concat(chunks); demand(actual.equals(expected), "Release attachment differs from committed metadata: " + name);
    }
  }
  const directory = path.join(cache.directory, "releases", releaseVersion);
  materialize(cache.repo, entries, directory);
  const release = { version: releaseVersion, commit, tree: entries, directory, manifest, manifestDigest: digest(manifestBytes) };
  cache.releases.set(releaseVersion, release); return release;
}
