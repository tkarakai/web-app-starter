import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isZonePath } from "./platform-upgrade/ownership.ts";

const REPO = "tkarakai/web-app-starter";
const URL = `https://github.com/${REPO}.git`;
export type Command = (command: string, args: string[]) => string;
export function commandAt(root: string): Command {
  return (command, args) => execFileSync(command, args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  }).trim();
}

/** Verify publication and the remote tag independently of the app's local tags/merge HEAD. */
export function adoptionRelease(root: string, from?: string, run = commandAt(root)): { version: string; commit: string } {
  const version = readFileSync(path.join(root, "platform/VERSION"), "utf8").trim();
  const tag = from ?? `v${version}`;
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${version}`) throw Error("--from-release must be a stable vX.Y.Z matching platform/VERSION");
  const recipe = `Start with git clone --branch ${tag} ${URL} my-app. For an existing repository, read platform/README.md#existing-repositories and use --from-release ${tag}.`;
  let release: { draft: boolean; prerelease: boolean; tag_name: string };
  let commit: string;
  try {
    release = JSON.parse(run("gh", ["api", `repos/${REPO}/releases/tags/${tag}`]));
    if (release.draft !== false || release.prerelease !== false || release.tag_name !== tag) throw Error("Not a published stable release");
    const refs = run("git", ["ls-remote", "--tags", URL, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).split("\n");
    const peeled = refs.find(line => line.endsWith(`refs/tags/${tag}^{}`));
    commit = (peeled ?? refs.find(line => line.endsWith(`refs/tags/${tag}`)) ?? "").split(/\s/)[0];
    if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("Release tag missing");
  } catch {
    throw Error(`Cannot verify published release ${tag}. Install/authenticate gh and check network access. ${recipe}`);
  }
  const head = run("git", ["rev-parse", "HEAD"]);
  if (!from && head !== commit) throw Error(`HEAD is not the published ${tag} commit. ${recipe}`);
  // Fetch only this immutable object, without adding any remote or importing deployment tags.
  try { run("git", ["cat-file", "-e", `${commit}^{commit}`]); }
  catch { run("git", ["fetch", "--no-tags", URL, commit]); }
  if (run("git", ["show", `${commit}:platform/VERSION`]).trim() !== version) throw Error("Release version does not match source");
  // Report both sides of a rename so moving a file out of the zone cannot hide its deletion.
  const changed = run("git", ["diff", "--name-only", "--no-renames", "-z", commit, "HEAD"]).split("\0").filter(isZonePath);
  if (changed.length) throw Error(`Platform source differs from ${tag}: ${changed.join(", ")}. Use the migration guide; adoption cannot manufacture a baseline.`);
  return { version, commit };
}
