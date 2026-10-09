import { commandAt, type Command } from "./adopt-release.ts";

/** Read-only preflight: app edits must happen on a task branch unless the owner overrides. */
export function prepareAdoptionWorkflow(root: string, options: { repo: string; name: string; allowDefaultBranch?: boolean }, run: Command = commandAt(root)): { taskBranch: string; override: boolean } {
  const remote = JSON.parse(run("gh", ["api", `repos/${options.repo}`])) as { default_branch?: string; full_name?: string };
  if (remote.full_name?.toLowerCase() !== options.repo.toLowerCase() || typeof remote.default_branch !== "string" || !remote.default_branch) {
    throw Error("Cannot verify target repository/default branch; check access before adoption.");
  }
  run("git", ["check-ref-format", "--branch", remote.default_branch]);
  const branch = run("git", ["branch", "--show-current"]);
  if (!branch) throw Error("Adoption needs a task branch. Run git switch -c adopt/app before adoption.");
  if (branch === remote.default_branch && !options.allowDefaultBranch) {
    throw Error(`Adoption on default branch ${branch} bypasses review. Run git switch -c adopt/app first, or use --allow-default-branch only with explicit owner authorization.`);
  }
  return { taskBranch: branch, override: branch === remote.default_branch };
}
