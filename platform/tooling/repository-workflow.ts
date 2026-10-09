import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ask, run, type Run } from "./deploy-setup/io.ts";
import { inspectRepositoryWorkflow, maintenanceAllowed } from "./repository-workflow/inspect.ts";
import { setupRepositoryWorkflow, type SetupOptions } from "./repository-workflow/setup.ts";
import { readRecord } from "./repository-workflow/state.ts";
import { readRecord as readUpdateIntent } from "./setup-updates/state.ts";
export { inspectRepositoryWorkflow, maintenanceAllowed, setupRepositoryWorkflow };
export { RECORD, readRecord, saveRecord } from "./repository-workflow/state.ts";
export type { RepositoryWorkflowStatus, WorkflowRecord, MaintenanceBot, RequiredCheck } from "./repository-workflow/types.ts";
export type { SetupOptions };

const HELP = `Usage: bun run platform:setup-repository [--check] [--json] [--repo owner/repo]
  --maintenance-bot exact-login[bot]  Read-only eligibility for this named maintenance App
  --discover-pr N                    Resume exact check discovery from the bootstrap PR
  --yes                              Owner consent for setup and saving discovery
  --approvals 0..6                    Owner-selected minimum approvals
  --dismiss-stale-reviews | --keep-stale-reviews
  --e2e always|on-demand|off           Explicit owner choice; otherwise preserve live policy
  --disable-auto-merge                Explicit owner consent to disable existing auto-merge
Setup preserves existing protection, caller customizations and credentials. Feature/bootstrap
PRs require owner or independent reviewer merge; deployment verification cannot prevent pushes.`;
type Dependencies = { exec?: Run; root?: string; write?: (text: string) => void; prompt?: (question: string) => Promise<string> };
export async function main(argv: string[], dependencies: Dependencies = {}): Promise<number> {
  const exec = dependencies.exec ?? run, root = dependencies.root ?? process.cwd(), write = dependencies.write ?? (text => process.stdout.write(text + "\n"));
  if (argv.includes("--help")) { write(HELP); return 0; }
  const options: SetupOptions = { consent: false };
  let check = false, json = false, repo: string | undefined, bot: string | undefined;
  const value = (index: number) => { const v = argv[index + 1]; if (!v || v.startsWith("--")) throw Error("Missing value for " + argv[index]); return v; };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--check": check = true; break;
      case "--json": json = true; break;
      case "--yes": options.consent = true; break;
      case "--repo": repo = value(i++); break;
      case "--maintenance-bot": bot = value(i++); check = true; break;
      case "--discover-pr": options.discoverPr = Number(value(i++)); break;
      case "--approvals": options.approvals = Number(value(i++)); break;
      case "--dismiss-stale-reviews": options.dismissStaleReviews = true; break;
      case "--keep-stale-reviews": options.dismissStaleReviews = false; break;
      case "--disable-auto-merge": options.disableAutoMerge = true; break;
      case "--e2e": { const v = value(i++); if (!["always", "on-demand", "off"].includes(v)) throw Error("Invalid --e2e mode"); options.e2e = v as SetupOptions["e2e"]; break; }
      default: throw Error(HELP);
    }
  }
  if (options.discoverPr !== undefined && (!Number.isSafeInteger(options.discoverPr) || options.discoverPr < 1)) throw Error("--discover-pr must be a positive PR number");
  if (check && (options.consent || options.approvals !== undefined || options.dismissStaleReviews !== undefined || options.e2e || options.disableAutoMerge || options.discoverPr)) throw Error("--check and --maintenance-bot are read-only; run setup separately to save policy/discovery.");
  const updateIntent = readUpdateIntent(root), workflowIntent = readRecord(root);
  const identities = [repo, updateIntent?.repository, workflowIntent?.repository].filter((value): value is string => value !== undefined);
  const origin = await exec("git", ["remote", "get-url", "origin"], undefined, undefined, root).catch(() => undefined);
  const originRepo = /^(?:(?:https?|git|ssh):\/\/(?:git@)?github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(origin?.trim() ?? "")?.[1];
  if (originRepo && originRepo.toLowerCase() !== "tkarakai/web-app-starter") identities.push(originRepo);
  if (new Set(identities.map(value => value.toLowerCase())).size > 1) throw Error("Conflicting downstream repository identity; inspect app-owned intent and origin before setup.");
  repo = identities[0];
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error("Repository identity cannot be verified; pass --repo owner/repo explicitly.");
  if (!check && !options.consent) {
    if (!dependencies.prompt && (!process.stdin.isTTY || !process.stdout.isTTY)) throw Error("Setup requires explicit owner consent with --yes; use --check --json for read-only inspection.");
    const prompt = dependencies.prompt ?? ask;
    write(JSON.stringify(await inspectRepositoryWorkflow(root, repo, exec), null, 2));
    options.consent = /^yes$/i.test(await prompt("Owner consent to configure squash/deletion/default-branch protection and save public workflow policy? [yes/no]"));
    if (!options.consent) throw Error("Stopped before setup; no settings changed.");
    options.approvals ??= Number(await prompt("Minimum approving reviewers [0..6]"));
    options.dismissStaleReviews ??= /^yes$/i.test(await prompt("Dismiss stale approvals after new commits? [yes/no]"));
  }
  const status = check ? await inspectRepositoryWorkflow(root, repo, exec) : await setupRepositoryWorkflow(root, repo, options, exec);
  const allowed = bot === undefined ? undefined : maintenanceAllowed(status, bot);
  write(json ? JSON.stringify({ ...status, ...(bot === undefined ? {} : { maintenanceBot: bot, maintenanceAllowed: allowed }) }, null, 2)
    : [`Repository workflow: ${status.readiness}; default branch: ${status.defaultBranch ?? "unknown"}`, ...status.checks.map(c => `${c.step}: ${c.status} — ${c.detail}`), ...(bot ? [`Maintenance ${bot}: ${allowed ? "allowed" : "blocked"}`] : []), status.deploymentGate.detail].join("\n"));
  return bot ? allowed ? 0 : 2 : status.readiness === "enforced" ? 0 : 2;
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(`repository-workflow: ${error instanceof Error ? error.message : "Setup failed; inspect and resume."}`); process.exitCode = 1; });
}
