// Guided deployment provisioning. Credentials live only in memory and provider secret stores.
// --check is read-only JSON; --prove resumes/displays staging proof without provisioning again.
import { appendFileSync, closeSync, constants, existsSync, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { apps, ENVIRONMENTS, loadState, saveState, readPublicFile, writePublicFile, secretName, STATE_FILE, validateState, values, type State } from "./deploy-setup/model.ts";
import { ask, hidden, interactive, run } from "./deploy-setup/io.ts";
import { checkSetup, configureBranch, convexAPI, ensureBackend, ensureDeployKey, ensureProject, github, secretNames, storeSecret, vercelAPI, type Request } from "./deploy-setup/providers.ts";
import { stagingProof } from "./deploy-setup/proof.ts";
import rawConfig from "../../app.config.ts";
import { validateAppConfig } from "../packages/app-config/src/schema.ts";

async function confirm(message: string) {
  if (!/^y(es)?$/i.test(await ask(`${message} [y/N]`))) throw Error("Stopped. Public progress is saved; rerun deploy:setup to resume.");
}
function ignoreState(root: string) {
  // Local exclusion also works before an older app has upgraded its app-owned .gitignore seam.
  return run("git", ["rev-parse", "--git-path", "info/exclude"]).then(file => {
    const target = path.resolve(root, file);
    const fd = openSync(target, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      if (!fstatSync(fd).isFile()) throw Error("Git exclude must be a regular file");
      const old = readFileSync(fd, "utf8"), patterns = [STATE_FILE, `${STATE_FILE}.tmp`, "ops.config.json", "ops.config.json.tmp"];
      const missing = patterns.filter(p => !old.split("\n").includes(p));
      if (missing.length) appendFileSync(fd, `${old.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
    } finally { closeSync(fd); }
  });
}
async function identity(root: string): Promise<State> {
  const prior = loadState(root);
  const origin = await run("git", ["remote", "get-url", "origin"]);
  const repo = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(origin)?.[1];
  if (!repo) throw Error("Set origin to the app's GitHub repository before setup.");
  if (prior && prior.repository !== repo) throw Error("Saved setup belongs to a different origin repository. Preserve it and start a separate setup file.");
  const metadata = await github<{ default_branch: string; permissions?: { admin: boolean } }>(repo, "");
  if (!metadata.permissions?.admin) throw Error(`Repository administration is required: https://github.com/${repo}/settings`);
  if (prior) return prior;
  const config = validateAppConfig(rawConfig);
  const suggestion = config.identity.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
  return validateState({ schema: 1, repository: repo, branch: metadata.default_branch,
    prefix: await ask(`Project prefix [${suggestion}]`) || suggestion,
    team: await ask("Vercel team ID (team_…; find it in team Settings → General)"),
    convexTeam: await ask("Convex team ID (numeric; shown when creating a team access token)"), projects: {}, backends: {} });
}
async function loginChecks() {
  const checks = await checkSetup(undefined, []);
  for (const check of checks.filter(c => c.step.endsWith("-login") && c.status !== "done")) {
    console.log(`${check.step}: ${check.instruction}`);
    await confirm("Sign in now with the official CLI?");
    await interactive("bun", ["run", "ops", "auth", "login", check.step.replace("-login", "")]);
  }
  const remaining = (await checkSetup(undefined, [])).filter(c => c.step.endsWith("-login") && c.status !== "done");
  if (remaining.length) throw Error(`Authentication still missing: ${remaining.map(c => c.step).join(", ")}`);
}
async function configureDomains(state: State, root: string, vercel: Request) {
  for (const app of apps(root)) for (const env of ENVIRONMENTS) {
    const project = state.projects[`${app}/${env}`]!;
    const domain = await ask(`${app}/${env} hostname [${project.domain}]`) || project.domain;
    if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) throw Error("Enter a hostname only, without a scheme or path.");
    // Persist the intended mapping before remote work so interruptions resume the same domain.
    project.domain = domain; saveState(root, state);
    const existing = await vercel<{ domains: { name: string; verified: boolean }[] }>(`/v9/projects/${project.id}/domains`);
    if (!existing.domains.some(d => d.name === domain)) await vercel(`/v10/projects/${project.id}/domains`, "POST", { name: domain });
    for (;;) {
      const record = await vercel<{ verified: boolean; verification?: { type: string; domain: string; value: string }[] }>(`/v9/projects/${project.id}/domains/${encodeURIComponent(domain)}`);
      const config = await vercel<{ misconfigured: boolean; recommendedCNAME?: { value: string }[]; recommendedIPv4?: { value: string[] }[] }>(`/v6/domains/${encodeURIComponent(domain)}/config`);
      let resolves = true; try { await lookup(domain); } catch { resolves = false; }
      if (record.verified && !config.misconfigured && resolves) break;
      console.log(`DNS for ${domain}: ${JSON.stringify({ verification: record.verification, cname: config.recommendedCNAME, ipv4: config.recommendedIPv4 })}`);
      console.log(`Update these records at your DNS provider. Vercel details: https://vercel.com/${state.team}/${project.name}/settings/domains`);
      await confirm("DNS/ownership records saved? Re-check now (or stop and resume later)");
      if (!record.verified) await vercel(`/v9/projects/${project.id}/domains/${encodeURIComponent(domain)}/verify`, "POST");
    }
  }
}
async function configure(state: State, root: string) {
  const installed = apps(root);
  const vercelToken = await hidden("Vercel token from https://vercel.com/account/tokens, scoped to the selected team; saved as GitHub VERCEL_TOKEN");
  const vercel = vercelAPI(vercelToken, state.team);
  await vercel("/v2/user");
  const convexToken = await hidden("Convex team access token from https://dashboard.convex.dev → Team Settings → Access Tokens; used only for this setup session");
  const convex = convexAPI(convexToken);
  const details = await convex<{ teamId: number }>("/token_details");
  if (String(details.teamId) !== state.convexTeam) throw Error("Convex token belongs to a different team.");
  await run("gh", ["variable", "set", "DEPLOY_SETUP_STATE", "--repo", state.repository, "--body", "configuring"]);
  for (const env of ENVIRONMENTS) {
    // PUT only when absent; never replace an existing environment's reviewers or protection rules.
    const environments = await github<{ environments: { name: string }[] }>(state.repository, "environments?per_page=100");
    if (!environments.environments.some(e => e.name === env)) await github(state.repository, `environments/${env}`, "PUT", {});
    for (const app of installed) { await ensureProject(state, app, env, vercel); saveState(root, state); }
    await ensureBackend(state, env, convex); saveState(root, state);
  }
  if (state.backends.staging!.id === state.backends.production!.id) throw Error("Staging and production must use separate Convex projects.");
  await configureDomains(state, root, vercel);
  await storeSecret(state.repository, "VERCEL_TOKEN", vercelToken);
  await storeSecret(state.repository, "VERCEL_ORG_ID", state.team);
  for (const env of ENVIRONMENTS) {
    const backend = state.backends[env]!;
    const keys = await secretNames(state.repository, env);
    if (!keys.has("CONVEX_DEPLOY_KEY")) {
      await confirm(`Create a production deploy key for ${env} backend ${backend.name} and save it to GitHub environment ${env}?`);
      await ensureDeployKey(state, env, convex);
    }
    // Use the official logged-in CLI for env administration on resume, not unreadable GitHub secrets.
    const targetEnv = { CONVEX_DEPLOY_KEY: "", CONVEX_DEPLOYMENT: "" };
    const convexEnv = (args: string[], input?: string) => run("bun", ["x", "convex", "env", ...args, "--deployment-name", backend.name], input, targetEnv);
    const names = new Set((await convexEnv(["list", "--names-only"])).split(/\s+/));
    const config = values(state, installed, env);
    for (const [name, value] of Object.entries(config.convex)) await convexEnv(["set", name], value);
    if (!names.has("BETTER_AUTH_SECRET")) await convexEnv(["set", "BETTER_AUTH_SECRET"], randomBytes(32).toString("base64"));
    if (!names.has("RESEND_API_KEY")) await convexEnv(["set", "RESEND_API_KEY"], await hidden(`${env} Resend API key from https://resend.com/api-keys (verify your sending domain first)`));
    if (!names.has("EMAIL_FROM")) {
      const from = await ask(`${env} verified sender email (https://resend.com/domains)`);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw Error("Enter a verified sender email address.");
      await convexEnv(["set", "EMAIL_FROM"], from);
    }
    for (const app of installed) {
      const project = state.projects[`${app}/${env}`]!;
      await storeSecret(state.repository, secretName(app, env), project.id);
      await vercel(`/v10/projects/${project.id}/env?upsert=true`, "POST", Object.entries(config.vercel[app]!).map(([key, value]) => ({ key, value, type: "encrypted", target: ["production"] })));
    }
  }
  const ciApps = [...installed];
  for (const landing of ["landing", "landing-static"] as const) if (!ciApps.includes(landing) && existsSync(path.join(root, `apps/${landing}/package.json`))) ciApps.push(landing);
  await configureBranch(state, ciApps);
  console.log(`Review production reviewers and branch rules: https://github.com/${state.repository}/settings/environments and /settings/branches. See platform/docs/deployment-runbook.md for required checks matching installed apps.`);
  await confirm("Production environment protections and branch rules reviewed/configured?");
  const protection = await github<{ protection_rules: { type: string }[] }>(state.repository, "environments/production");
  if (!protection.protection_rules.some(rule => rule.type === "required_reviewers")) throw Error("Production needs a required reviewer. Add one in environment settings, then resume; setup will not weaken protection.");
  const opsText = readPublicFile(root, "ops.config.json");
  const current = opsText ? JSON.parse(opsText) as Record<string, unknown> : {};
  if (current.repository && current.repository !== state.repository) throw Error("ops.config.json targets another repository; review it before continuing.");
  const mapped = Object.fromEntries(installed.map(app => [app, { projects: Object.fromEntries(ENVIRONMENTS.map(env => [env, { id: state.projects[`${app}/${env}`]!.id, domain: state.projects[`${app}/${env}`]!.domain }])) }]));
  await confirm("Save selected project mappings to ops.config.json and enable automatic staging deployments?");
  writePublicFile(root, "ops.config.json", `${JSON.stringify({ ...current, repository: state.repository, workflowRef: state.branch, teamId: state.team, apps: { ...(current.apps as object ?? {}), ...mapped } }, null, 2)}\n`);
  await run("gh", ["variable", "set", "DEPLOY_SETUP_STATE", "--repo", state.repository, "--body", "ready"]);
}
async function prove(state: State, root: string) {
  await stagingProof(state, { github: endpoint => github(state.repository, endpoint), run,
    watch: args => interactive("bun", args), confirm, save: value => saveState(root, value), tell: message => console.log(message) });
  for (const app of apps(root)) console.log(`${app}: https://${state.projects[`${app}/staging`]!.domain}`);
}
export async function main(argv: string[]) {
  if (argv.some(arg => !["--check", "--prove", "--help"].includes(arg)) || (argv.includes("--check") && argv.includes("--prove"))) throw Error("Usage: bun run deploy:setup [--check | --prove]");
  if (argv.includes("--help")) { console.log("deploy:setup provisions selected Vercel apps, separate Convex environments and GitHub credentials. --check: read-only JSON. --prove: staging deployment verification. Resume by rerunning; credentials never enter the saved public state."); return; }
  const root = process.cwd(), installed = apps(root);
  if (argv.includes("--check")) {
    const checks = await checkSetup(loadState(root), installed);
    console.log(JSON.stringify({ checks, complete: checks.every(c => c.status === "done") }, null, 2));
    process.exitCode = checks.every(c => c.status === "done") ? 0 : 2; return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("Run deploy:setup in an interactive terminal. Agents should use --check; never send credentials in chat.");
  if (argv.includes("--prove")) { const state = loadState(root); if (!state) throw Error("Run deploy:setup first."); await prove(state, root); return; }
  console.log("Start early: create accounts/choose billing at https://vercel.com/dashboard and https://dashboard.convex.dev; arrange DNS access and verify your sender at https://resend.com/domains. Tokens are entered later, locally with hidden prompts.");
  await loginChecks();
  const state = await identity(root);
  console.log(`Repository: ${state.repository}; Vercel team: ${state.team}; Convex team: ${state.convexTeam}. Projects: ${installed.join(", ")} in staging and production. Vercel Git integration is not used. Static landing has its own Other/out projects.`);
  await confirm("Create/reuse these projects and configure their deployment settings?");
  await ignoreState(root); saveState(root, state);
  await configure(state, root);
  await prove(state, root);
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(`deploy:setup: ${error instanceof Error ? error.message : "Setup failed; resume later."}`); process.exitCode = 1; });
}
