// Choosing when E2E runs on pull requests (PLATFORM_CI_PR_E2E, platform/docs/ci.md#e2e-on-pull-requests).
// On a private repository GitHub Actions minutes are metered and E2E is most of what a push costs,
// so `bun run adopt` and `bun run deploy:setup` offer the choice there. Public repositories keep
// the default: their Actions minutes are free.

export const VARIABLE = "PLATFORM_CI_PR_E2E";
export const LABEL = "run-e2e";
export const MODES = ["always", "on-demand", "off"] as const;
export type Mode = (typeof MODES)[number];
export type Exec = (file: string, args: string[]) => Promise<string>;
export type PrE2eStatus = { private: boolean; mode?: string };

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

/** Repository visibility and the current setting. Needs `gh` signed in with access to the repository's variables. */
export async function prE2eStatus(repo: string, exec: Exec): Promise<PrE2eStatus> {
  const metadata = JSON.parse(await exec("gh", ["api", `repos/${repo}`])) as { private: boolean };
  // Repository variables are shared by everyone's CI runs; a repository has few, so one page is enough.
  const listed = JSON.parse(await exec("gh", ["api", `repos/${repo}/actions/variables?per_page=100`, "--jq", ".variables"])) as { name: string; value: string }[];
  return { private: metadata.private, mode: listed.find((variable) => variable.name === VARIABLE)?.value };
}

/** Whether to offer the choice: a private repository that hasn't chosen yet. */
export function needsChoice(status: PrE2eStatus): boolean {
  return status.private && status.mode === undefined;
}

export function describeModes(repo: string): string[] {
  return [
    `${repo} is private: GitHub Actions minutes are metered, and E2E is most of what CI costs.`,
    "A push to a ready pull request that touches the web app costs about 55-65 minutes with E2E;",
    "GitHub Free includes 2,000 minutes a month. Choose when E2E runs on pull requests:",
    "  always     every push to a ready PR (default). Drafts skip E2E: iterate in draft PRs.",
    `  on-demand  only once the PR has the ${LABEL} label; until then CI Complete fails, so E2E`,
    "             still blocks the merge (needs branch protection: a paid plan on private repositories).",
    "  off        never on PRs; run CI=true bun run ci locally before merging.",
    "Deploys run E2E in every mode. Details: platform/docs/private-repo-ci.md.",
  ];
}

/** Set the mode; on-demand also creates the label. */
export async function applyPrE2e(repo: string, mode: Mode, exec: Exec): Promise<string[]> {
  await exec("gh", ["variable", "set", VARIABLE, "--repo", repo, "--body", mode]);
  const done = [`${VARIABLE}=${mode}`];
  if (mode === "on-demand") {
    await exec("gh", ["label", "create", LABEL, "--repo", repo, "--color", "0E8A16", "--description", `Run E2E on this PR (${VARIABLE}=on-demand)`, "--force"]);
    done.push(`label ${LABEL}`);
  }
  return done;
}

export function manualCommand(repo: string): string {
  return `gh variable set ${VARIABLE} --repo ${repo} --body <always|on-demand|off>`;
}
