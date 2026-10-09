import { commandAt, type Command } from "./adopt-release.ts";

export type AdoptionWorkflow = { repository: string; defaultBranch: string; taskBranch: string; bootstrapCommit?: string; override: boolean };
const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";

/** Inspect the target before editing. Bootstrap creates only local commits and branches. */
export function prepareAdoptionWorkflow(root: string, options: { repo: string; name: string; bootstrap?: boolean; allowDefaultBranch?: boolean }, run: Command = commandAt(root)): AdoptionWorkflow {
  const remote = JSON.parse(run("gh", ["api", `repos/${options.repo}`])) as { default_branch: string; full_name: string };
  if (remote.full_name?.toLowerCase() !== options.repo.toLowerCase() || !remote.default_branch) throw Error("Cannot verify target repository/default branch; check access before adoption.");
  run("git", ["check-ref-format", "--branch", remote.default_branch]);
  // An empty result is evidence only after a successful authenticated remote query.
  const refs = run("git", ["ls-remote", "--heads", `https://github.com/${options.repo}.git`]);
  const branch = run("git", ["branch", "--show-current"]);
  const task = "bootstrap/adopt-" + (options.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app");
  if (!refs) {
    if (!options.bootstrap) throw Error("Target repository is empty. Rerun adopt with --bootstrap to create a minimal local base and adoption branch; no remote branch will be pushed automatically.");
    if (options.allowDefaultBranch) throw Error("--bootstrap and --allow-default-branch cannot be combined.");
    const source = run("git", ["rev-parse", "HEAD"]);
    // A deliberate empty root commit makes the first PR possible without shipping app work on main.
    const tree = run("git", ["mktree"]);
    const commit = run("git", ["commit-tree", tree, "-m", "Initialize repository for reviewed adoption"]);
    run("git", ["switch", "-c", task, commit]);
    run("git", ["merge", "--allow-unrelated-histories", "--no-ff", source, "-m", "Import starter for adoption review"]);
    return { repository: options.repo, defaultBranch: remote.default_branch, taskBranch: task, bootstrapCommit: commit, override: false };
  }
  if (!refs.split("\n").some(line => line.endsWith(`refs/heads/${remote.default_branch}`))) throw Error("Target default branch does not exist but other branches do. Ask the owner to select a default branch before adoption.");
  if (options.bootstrap) throw Error("--bootstrap requires a positively verified empty target repository.");
  if (branch === remote.default_branch && !options.allowDefaultBranch) throw Error(`Adoption on default branch ${branch} bypasses review. Run git switch -c ${task} first, or use --allow-default-branch only with explicit owner authorization.`);
  if (!branch) { run("git", ["switch", "-c", task]); return { repository: options.repo, defaultBranch: remote.default_branch, taskBranch: task, override: false }; }
  return { repository: options.repo, defaultBranch: remote.default_branch, taskBranch: branch, override: branch === remote.default_branch };
}

/** Exact review commands; the owner deliberately pushes the minimal base, never the app to it. */
export function adoptionCommands(workflow: AdoptionWorkflow): string[] {
  const { repository, defaultBranch, taskBranch, bootstrapCommit } = workflow;
  const target = quote(`https://github.com/${repository}.git`);
  if (workflow.override) return ["Owner-authorized default-branch override: adoption bypassed the normal PR workflow. Create a task branch before continuing app work."];
  return [
    ...(bootstrapCommit ? [`Owner bootstrap step (only this empty commit): git push ${target} ${bootstrapCommit}:refs/heads/${quote(defaultBranch)}`] : []),
    "Review and commit the adoption on " + taskBranch + "; run CI=true bun run ci before final review.",
    `git push ${target} HEAD:refs/heads/${quote(taskBranch)}`,
    `gh pr create --repo ${quote(repository)} --draft --base ${quote(defaultBranch)} --head ${quote(taskBranch)} --title 'Adopt starter' --body 'Review adoption and repository setup before merging.'`,
    `bun run platform:setup-repository --repo ${quote(repository)} --check --json`,
    "Resume repository setup with --discover-pr <PR-number> after draft CI publishes contexts. An owner or independent reviewer decides the merge; bootstrap never grants auto-merge authority.",
  ];
}
