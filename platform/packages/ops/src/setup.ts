import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { account, authSource, githubApi, login, projects, requireInteractive, resolveTeam, teams, vercelApi, type Log, type Project, type Team } from "./auth";
import { command, defaultConfig, validateConfig } from "./config";
import { inspectConfig } from "./config-repair";
import { errorInfo, OpsError } from "./errors";
import { safeCell } from "./output";
import { terminalSelect, type Select } from "./prompts";
import type { Options } from "./options";
import type { Alias, Config, Environment, Result } from "./types";

export type Ask = (question: string) => Promise<string>;
export type Tell = (message: string) => void;

export interface SetupUI { interactive: () => boolean; ask: Ask; tell: Tell }
export const terminalSetupUI: SetupUI = {
  interactive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  tell: message => console.log(message),
  // Open readline only while asking, so the official login CLIs own stdin during login.
  ask: async question => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const abort = new globalThis.AbortController();
    rl.once("SIGINT", () => abort.abort());
    rl.once("close", () => abort.abort());
    try { return await rl.question(safeCell(question), { signal: abort.signal }); }
    catch (cause) {
      if (abort.signal.aborted) throw new OpsError("INTERRUPTED", "Setup interrupted; configuration was not saved.", "Run ops setup to start again.", 130, {}, { cause });
      throw cause;
    }
    finally { rl.close(); }
  },
};

// Return false when the operator starts setup but cancels saving, so the original
// command (especially a deployment) is not unexpectedly resumed after cancellation.
export async function offerSetup(o: Options, log: Log, ui: SetupUI = terminalSetupUI, runSetup = setup): Promise<boolean> {
  if (o.command === "watch" && !o.until) return true;
  if (["runs", "logs", "history", "builds", "candidates", "diagnose", "auth", "teams", "projects"].includes(o.command)) return true;
  if (o.json || !ui.interactive() || ["help", "setup"].includes(o.command)) return true;
  const path = o.config ?? "ops.config.json";
  let issues: string[] | undefined;
  try {
    issues = inspectConfig(await readFile(path, "utf8")).issues;
    if (!issues.length) return true;
  } catch (cause) {
    if ((cause as { code?: string }).code !== "ENOENT") throw new OpsError("CONFIG", `Cannot check configuration ${path}: ${String(cause)}`, "Check the path and read permissions, or use --config PATH.", 2, {}, { cause });
  }
  if (issues) {
    ui.tell(`Configuration needs attention: ${safeCell(resolve(path))}`);
    for (const issue of issues) ui.tell(`  • ${safeCell(issue)}`);
    ui.tell("Guided repair will keep valid settings as defaults. Your file will only change after you review and save the replacement.");
  } else {
    ui.tell(`No ops configuration file found at ${safeCell(path)}.`);
    ui.tell("Setup will connect GitHub and Vercel and help you choose the projects for each app and environment.");
  }
  for (;;) {
    const answer = (await ui.ask(`Run guided ${issues ? "repair" : "setup"} now, then continue with ops ${o.command}? [Y/n]: `)).trim();
    if (/^(n|no)$/i.test(answer)) {
      ui.tell("Continuing without setup. You can run bun run ops setup later.");
      return true;
    }
    if (answer && !/^(y|yes)$/i.test(answer)) { ui.tell("Enter y or n."); continue; }
    const result = await runSetup(o, log);
    if (!result.saved) { ui.tell("Setup was not saved. The original command was not run."); return false; }
    ui.tell(`Setup complete. Continuing with ops ${o.command}.`);
    return true;
  }
}
async function choose(label: string, choices: string[], ask: Ask, tell: Tell, initial?: number, select?: Select): Promise<number> {
  if (select) return select(label, choices, initial);
  tell(label);
  choices.forEach((choice, i) => tell(`  ${i + 1}. ${safeCell(choice)}`));
  for (;;) {
    const answer = (await ask(`Select 1–${choices.length}${initial === undefined ? "" : ` [${initial + 1}]`}: `)).trim();
    const selected = !answer && initial !== undefined ? initial : /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    if (selected >= 0 && selected < choices.length) return selected;
    tell("Enter one of the listed numbers.");
  }
}
export async function chooseDomain(target: string, aliases: Alias[], priorDomain: string | null | undefined, ask: Ask, tell: Tell, select?: Select): Promise<string | null> {
  const domains = [...new Set(aliases.map(a => a.alias))].sort((a, b) => Number(a.endsWith(".vercel.app")) - Number(b.endsWith(".vercel.app")) || a.localeCompare(b));
  if (domains.length) {
    const existing = priorDomain ? domains.indexOf(priorDomain) : -1;
    const index = await choose(`Which hostname should ops track for ${target}?\nChoose the address people use to visit this app. Other aliases can point to older deployments.`,
      [...domains, "Enter another hostname", "Track all domains (different deployments will be reported as domains-diverge)"], ask, tell,
      existing >= 0 ? existing : priorDomain === null ? domains.length + 1 : domains.length === 1 ? 0 : undefined, select);
    if (index < domains.length) return domains[index];
    if (index === domains.length + 1) return null;
  } else tell("This project has no domain aliases yet. Enter its intended hostname, or leave blank to track all domains once deployed.");
  for (;;) {
    const answer = (await ask(`Hostname for ${target} (without https://)${priorDomain ? ` [${priorDomain}]; '-' clears it` : ""}: `)).trim();
    const domain = answer === "-" ? undefined : answer || priorDomain;
    if (!domain || /^[a-zA-Z0-9.-]+$/.test(domain)) return domain || null;
    tell("Enter a hostname without https:// or a path, or leave it blank.");
  }
}
export async function configureProjects(config: Config, teamList: Team[], getProjects: (teamId?: string) => Promise<Project[]>, ask: Ask, tell: Tell, selectedTeam?: string, getAliases: (projectId: string, teamId?: string) => Promise<Alias[]> = async () => [], select?: Select): Promise<Config> {
  if (!teamList.length) throw new OpsError("NO_TEAMS", "No accessible Vercel teams were found.", "Check the account with ops auth status, then join or create the Vercel team that owns the projects.", 2);
  const current = teamList.findIndex(t => t.id === config.teamId);
  const selection = selectedTeam ? teamList.findIndex(t => t.id === selectedTeam)
    : await choose("Choose the Vercel account used by these projects:", teamList.map(t => `${t.name} (${t.slug}) — ${t.id}`), ask, tell, current >= 0 ? current : teamList.length === 1 ? 0 : undefined, select);
  if (selection < 0) throw new OpsError("TEAM_NOT_FOUND", "The selected Vercel team is unavailable.", "Run ops teams and retry setup.", 2);
  const teamId = teamList[selection]?.id;
  const available = await getProjects(teamId);
  if (!available.length) throw new OpsError("NO_PROJECTS", "This Vercel account has no accessible projects.", "Check ops teams and team permissions; rerun setup with the account that owns your projects.", 2);
  const next = defaultConfig(config.repository);
  next.workflowRef = config.workflowRef;
  next.teamId = teamId;
  next.apps = {};
  tell("Next, choose which Vercel project hosts each app in staging and production. You will make one selection for each app and environment.");
  const used = new Set<string>();
  let step = 0;
  const total = Object.keys(config.apps).length * 2;
  for (const [app, settings] of Object.entries(config.apps)) {
    next.apps[app] = { projects: {} };
    for (const env of ["staging", "production"] as Environment[]) {
      const old = !config.teamId || config.teamId === teamId ? settings.projects[env] : undefined;
      const existing = old ? available.findIndex(p => p.id === old.id) : -1;
      const target = `the "${app}" app in ${env.toUpperCase()}`;
      ++step;
      let index: number;
      for (;;) {
        index = await choose(`\n[${step}/${total}] Which Vercel project hosts ${target}?`, [...available.map(p => `${p.name} — ${p.id}${used.has(p.id) ? " (already assigned)" : ""}`), `Skip — set up ${app} in ${env} later`], ask, tell, existing >= 0 && !used.has(available[existing].id) ? existing : old === null ? available.length : undefined, select);
        if (!available[index] || !used.has(available[index].id)) break;
        tell("That project is already assigned to another app/environment. Choose a different project or Skip.");
      }
      const project = available[index];
      if (!project) { next.apps[app].projects[env] = null; tell(`Skipped ${app} in ${env}; ops will list it as not tracked. You can configure it later with ops setup.`); continue; }
      used.add(project.id);
      tell(`Selected: ${app} in ${env} → ${safeCell(project.name)}.`);
      const priorDomain = old?.id === project.id ? old.domain : undefined;
      const domain = await chooseDomain(target, await getAliases(project.id, teamId), priorDomain, ask, tell, select);
      next.apps[app].projects[env] = { id: project.id, domain };
    }
  }
  return validateConfig(next);
}
export async function saveConfig(path: string, config: Config, original: string | undefined): Promise<void> {
  const file = resolve(path);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let current: string | undefined;
  try { current = await readFile(file, "utf8"); }
  catch (cause) { if ((cause as { code?: string }).code !== "ENOENT") throw cause; }
  if (current !== original) throw new OpsError("CONFIG_CHANGED", `${path} changed during setup.`, "Rerun setup to preserve the other changes.", 2);
  try {
    await writeFile(temporary, `${JSON.stringify(validateConfig(config), null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } catch (cause) {
    throw new OpsError("CONFIG_WRITE", `Cannot save ${path}: ${String(cause)}`, "Check the directory and write permissions; the configuration was not saved successfully.", 2, {}, { cause });
  } finally {
    try { await unlink(temporary); }
    catch (cause) { if ((cause as { code?: string }).code !== "ENOENT") console.error(`Cannot clean up setup temporary file ${temporary}: ${safeCell(String(cause))}`); }
  }
}
export async function setup(o: Options, log: Log): Promise<Result> {
  requireInteractive(o.json);
  const path = o.config ?? "ops.config.json";
  let original: string | undefined;
  let existing: Config | undefined;
  const { tell, ask } = terminalSetupUI;
  try {
    original = await readFile(path, "utf8");
    const inspection = inspectConfig(original);
    existing = inspection.draft;
    if (inspection.issues.length) {
      tell(`Repairing ${safeCell(resolve(path))}. Valid settings will be offered as defaults:`);
      for (const issue of inspection.issues) tell(`  • ${safeCell(issue)}`);
    }
  } catch (cause) {
    if ((cause as { code?: string }).code !== "ENOENT") throw new OpsError("CONFIG", `Cannot load ${path}: ${String(cause)}`, "Check the path and read permissions, or use --config with a new path.", 2, {}, { cause });
  }
  tell("Ops setup — credentials stay with gh / vercel. Only repository, team and project mappings are saved.");
  for (const provider of ["github", "vercel"] as const) {
    try { const result = await account(provider, log); tell(`${provider}: authenticated as ${safeCell(result.account)} via ${authSource(provider)}.`); }
    catch (cause) {
      const error = errorInfo(cause);
      console.error(`Error [${error.code}]: ${safeCell(error.message)}\n${safeCell(error.hint)}`);
      if (!["AUTH", "AUTH_REQUIRED"].includes(error.code)) throw cause;
      if (!/^(y|yes)$/i.test((await ask(`Run the official ${provider} login now? [y/N]: `)).trim())) throw cause;
      await login(provider);
      const result = await account(provider, log);
      tell(`${provider}: authenticated as ${safeCell(result.account)}.`);
    }
  }
  let repository = o.repo ?? existing?.repository;
  if (!repository) {
    try { repository = await command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]); }
    catch (cause) { const e = errorInfo(cause); console.error(`Error [${e.code}]: ${safeCell(e.message)}`); tell("Enter the repository manually below."); }
  }
  for (;;) {
    repository = (await ask(`GitHub repository owner/repo${repository ? ` [${repository}]` : ""}: `)).trim() || repository;
    if (repository && /^[\w.-]+\/[\w.-]+$/.test(repository)) break;
    tell("Enter a repository as owner/repository.");
  }
  const config = existing ?? defaultConfig(repository);
  config.repository = repository;
  await githubApi(log).get(`/repos/${repository}`);
  config.workflowRef = (await ask(`Deployment workflow branch [${config.workflowRef}]: `)).trim() || config.workflowRef;
  const api = vercelApi(log);
  const selected = o.team ? await resolveTeam(api, o.team) : undefined;
  const next = await configureProjects(config, await teams(api), id => projects(api, id), ask, tell, selected,
    (id, teamId) => api.pages<Alias>(`/v4/aliases?${new URLSearchParams({ projectId: id, ...(teamId ? { teamId } : {}) })}`, "aliases", 1000), terminalSelect);
  tell(`\nConfiguration to save to ${safeCell(path)}:\n${JSON.stringify(next, null, 2)}`);
  if (!/^(y|yes)$/i.test((await ask(`Save ${existing ? "and replace the existing config" : "this config"}? [y/N]: `)).trim())) return { saved: false, configPath: path };
  await saveConfig(path, next, original);
  tell(`Saved configuration to ${resolve(path)}.`);
  const missing = Object.entries(next.apps).flatMap(([app, c]) => ["staging", "production"].filter(env => c.projects[env as Environment] === undefined).map(env => `${app}/${env}`));
  const skipped = Object.entries(next.apps).flatMap(([app, c]) => ["staging", "production"].filter(env => c.projects[env as Environment] === null).map(env => `${app}/${env}`));
  return { saved: true, configPath: resolve(path), repository: next.repository, teamId: next.teamId, missingProjectMappings: missing, skippedProjectMappings: skipped,
    nextStep: `Run bun run ops doctor --config ${JSON.stringify(path)}${missing.length ? "; complete the missing mappings" : ", then bun run ops status"}.` };
}
