import path from "node:path";
import { verifyServing } from "./proof.ts";
import { api, HttpError, run, type Run } from "./io.ts";
import { ENVIRONMENTS, ciApps, proofContext, secretName, settings, values, type App, type Environment, type State } from "./model.ts";
export function convexEnv(backend: string, args: string[], input?: string, exec: Run = run) {
  return exec("bun", ["x", "convex", "env", ...args, "--deployment-name", backend], input,
    { CONVEX_DEPLOY_KEY: "", CONVEX_DEPLOYMENT: "" }, path.resolve("packages/backend"));
}
export function requiredChecks(installed: App[]): string[] {
  const title = (app: App) => app === "landing-static" ? "Landing Static" : app[0].toUpperCase() + app.slice(1);
  return ["CI Shared Complete", "CI Storybook Complete", ...installed.map(app => "CI " + title(app) + " Complete")];
}
export type Request = <T>(endpoint: string, method?: string, body?: unknown) => Promise<T>;
export type Check = { step: string; status: "done" | "missing" | "human-only" | "unavailable"; instruction?: string };
export const convexAPI = (token: string): Request => (endpoint, method, body) => api("https://api.convex.dev/v1", endpoint, token, method, body);
export const vercelAPI = (token: string, team: string): Request => (endpoint, method, body) => api("https://api.vercel.com", `${endpoint}${endpoint.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}`, token, method, body);
export async function github<T>(repo: string, endpoint: string, method = "GET", body?: unknown, exec: Run = run): Promise<T> {
  const args = ["api", `repos/${repo}/${endpoint}`, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  const result = await exec("gh", args, body === undefined ? undefined : JSON.stringify(body));
  return result ? JSON.parse(result) as T : undefined as T;
}
export async function storeSecret(repo: string, name: string, value: string, env?: Environment, exec: Run = run) {
  await exec("gh", ["secret", "set", name, "--repo", repo, ...(env ? ["--env", env] : [])], value);
}
export async function secretNames(repo: string, env?: Environment, exec: Run = run): Promise<Set<string>> {
  const rows = JSON.parse(await exec("gh", ["secret", "list", "--repo", repo, ...(env ? ["--env", env] : []), "--json", "name"])) as { name: string }[];
  return new Set(rows.map(row => row.name));
}
export async function ensureProject(state: State, app: App, env: Environment, request: Request) {
  const key = `${app}/${env}` as const;
  const name = state.projects[key]?.name ?? `${state.prefix}-${app}${env === "staging" ? "-staging" : ""}`;
  const expected = settings(app);
  type Remote = { id: string; name: string; link?: unknown } & ReturnType<typeof settings>;
  let project: Remote;
  try { project = await request<Remote>(`/v9/projects/${encodeURIComponent(state.projects[key]?.id ?? name)}`); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404 || state.projects[key]) throw error;
    project = await request<Remote>("/v11/projects", "POST", { name, ...expected, skipGitConnectDuringLink: true });
  }
  if (project.link) throw Error(`${name} has a Git connection. Disconnect it in Vercel Settings → Git, then resume; Actions owns deployment.`);
  for (const [field, value] of Object.entries(expected)) {
    if (project[field as keyof Remote] !== value) throw Error(`${name}: ${field} must be ${JSON.stringify(value)}. Review its build settings, then resume.`);
  }
  const domains = await request<{ domains: { name: string }[] }>(`/v9/projects/${project.id}/domains`);
  const assigned = domains.domains.find(d => d.name.endsWith(".vercel.app"))?.name ?? domains.domains[0]?.name;
  state.projects[key] = { id: project.id, name: project.name, domain: state.projects[key]?.domain ?? assigned ?? `${project.name}.vercel.app` };
}
export async function ensureBackend(state: State, env: Environment, request: Request) {
  const name = `${state.prefix}-${env}`;
  let id = state.backends[env]?.id;
  if (!id) {
    let cursor: string | undefined;
    do {
      const page = await request<{ items: { id: number; name: string }[]; pagination: { hasMore: boolean; nextCursor?: string } }>(`/teams/${state.convexTeam}/projects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      const matches = page.items.filter(item => item.name === name);
      if (matches.length > 1 || (id && matches.length)) throw Error(`Multiple Convex projects named ${name}; choose a mapping explicitly.`);
      id = matches[0]?.id ?? id;
      if (page.pagination.hasMore && !page.pagination.nextCursor) throw Error("Convex pagination incomplete");
      cursor = page.pagination.hasMore ? page.pagination.nextCursor : undefined;
    } while (cursor);
    if (!id) id = (await request<{ id: number }>(`/teams/${state.convexTeam}/create_project`, "POST", { projectName: name, deploymentType: "prod" })).id;
  }
  const deployments = await request<{ name: string; deploymentUrl: string; deploymentType: string; isDefault: boolean }[]>(`/projects/${id}/list_deployments`);
  const prod = deployments.filter(d => d.deploymentType === "prod" && d.isDefault);
  if (prod.length !== 1) throw Error(`${name} needs one default production deployment. Configure it at https://dashboard.convex.dev and resume.`);
  state.backends[env] = { id, name: prod[0].name, url: prod[0].deploymentUrl };
}
export async function checkSetup(state: State | undefined, installed: App[], exec: Run = run, requiredApps: App[] = ciApps(process.cwd())): Promise<Check[]> {
  const checks: Check[] = [];
  const check = async (step: string, action: () => Promise<boolean>, instruction: string) => {
    try { checks.push({ step, status: await action() ? "done" : "missing", instruction }); }
    catch { checks.push({ step, status: "unavailable", instruction }); }
  };
  await check("github-login", async () => { await exec("gh", ["auth", "status", "--hostname", "github.com"]); return true; }, "bun run ops auth login github");
  await check("vercel-login", async () => { await exec("vercel", ["whoami"]); return true; }, "bun run ops auth login vercel");
  await check("convex-login", async () => /Status: Logged in/.test(await exec("bun", ["x", "convex", "login", "status"])), "bun run ops auth login convex");
  if (!state) return [...checks, { step: "setup", status: "missing", instruction: "Run bun run deploy:setup in a terminal. Start accounts/billing at https://vercel.com/dashboard and https://dashboard.convex.dev; arrange domain/DNS access early." }];
  await check("repository-admin", async () => Boolean((await github<{ permissions?: { admin: boolean } }>(state.repository, "", "GET", undefined, exec)).permissions?.admin), `Repository administration is required: https://github.com/${state.repository}/settings`);
  await check("repository-secrets", async () => {
    const names = await secretNames(state.repository, undefined, exec);
    return ["VERCEL_TOKEN", "VERCEL_ORG_ID", ...ENVIRONMENTS.flatMap(env => installed.map(app => secretName(app, env)))].every(key => names.has(key));
  }, "Resume deploy:setup; this check sees secret names, not stored credential validity.");
  for (const env of ENVIRONMENTS) {
    await check(`convex-key-${env}`, async () => (await secretNames(state.repository, env, exec)).has("CONVEX_DEPLOY_KEY"), `Resume deploy:setup for the ${env} environment key.`);
    await check(`convex-env-${env}`, async () => {
      const backend = state.backends[env]; if (!backend) return false;
      const names = new Set((await convexEnv(backend.name, ["list", "--names-only"], undefined, exec)).split(/\s+/));
      if (!["SITE_URL", "ADMIN_SITE_URL", "LANDING_URL", "BETTER_AUTH_SECRET", "RESEND_API_KEY", "EMAIL_FROM"].every(name => names.has(name))) return false;
      for (const [name, value] of Object.entries(values(state, installed, env).convex)) {
        if ((await convexEnv(backend.name, ["get", name], undefined, exec)).trim() !== value) return false;
      }
      return true;
    }, "Resume deploy:setup to verify backend origins and hosted email configuration; secret values are not printed.");
    for (const app of installed) {
      const project = state.projects[`${app}/${env}`];
      await check(`vercel-${app}-${env}`, async () => {
        if (!project) return false;
        const remote = JSON.parse(await exec("vercel", ["api", `/v9/projects/${project.id}`, "--scope", state.team, "--raw", "--non-interactive"])) as Record<string, unknown>;
        return !remote.link && Object.entries(settings(app)).every(([key, value]) => remote[key] === value);
      }, `Resume deploy:setup to configure ${app}/${env}.`);
      await check(`domain-${app}-${env}`, async () => {
        if (!project) return false;
        const domain = JSON.parse(await exec("vercel", ["api", `/v9/projects/${project.id}/domains/${encodeURIComponent(project.domain)}`, "--scope", state.team, "--raw", "--non-interactive"])) as { verified: boolean };
        const config = JSON.parse(await exec("vercel", ["api", `/v6/domains/${encodeURIComponent(project.domain)}/config`, "--scope", state.team, "--raw", "--non-interactive"])) as { misconfigured: boolean };
        return domain.verified && !config.misconfigured;
      }, "Resume deploy:setup to check DNS and domain ownership.");
      await check(`vercel-env-${app}-${env}`, async () => {
        if (!project) return false;
        const result = JSON.parse(await exec("vercel", ["api", `/v9/projects/${project.id}/env`, "--scope", state.team, "--raw", "--non-interactive"])) as { envs: { key: string; target: string[] }[] };
        return Object.keys(values(state, installed, env).vercel[app]!).every(key => result.envs.some(e => e.key === key && e.target.includes("production")));
      }, "Resume deploy:setup to set the generated environment values. This check verifies presence, not decrypted values.");
    }
  }
  await check("production-reviewer", async () => (await github<{ protection_rules: { type: string }[] }>(state.repository, "environments/production", "GET", undefined, exec)).protection_rules.some(r => r.type === "required_reviewers"), `Configure a production reviewer: https://github.com/${state.repository}/settings/environments`);
  await check("branch-protection", async () => {
    const protection = await github<{ required_pull_request_reviews?: unknown; required_status_checks?: { contexts?: string[]; checks?: { context: string }[] } }>(state.repository, `branches/${encodeURIComponent(state.branch)}/protection`, "GET", undefined, exec);
    const contexts = new Set([...(protection.required_status_checks?.contexts ?? []), ...(protection.required_status_checks?.checks ?? []).map(c => c.context)]);
    return Boolean(protection.required_pull_request_reviews) && requiredChecks(requiredApps).every(context => contexts.has(context));
  }, "Resume deploy:setup to configure required checks and PR review.");
  await check("staging-proof", async () => {
    if (!state.proof || state.request?.context !== proofContext(state, installed)) return false;
    await verifyServing(state, installed, exec); return true;
  }, "Run deploy:setup --prove to deploy the reviewed default-branch commit and watch its actual result.");
  return checks;
}

/** Add the installed app checks without replacing an existing branch's review/access policy. */
export async function configureBranch(state: State, installed: App[], exec: Run = run) {
  const contexts = requiredChecks(installed);
  const endpoint = `branches/${encodeURIComponent(state.branch)}/protection`;
  type Protection = { required_status_checks?: { strict: boolean; contexts: string[]; checks?: { context: string; app_id: number | null }[] }; required_pull_request_reviews?: unknown };
  let old: Protection | undefined;
  try { old = await github<Protection>(state.repository, endpoint, "GET", undefined, exec); }
  catch (error) {
    if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
  }
  if (!old) {
    await github(state.repository, endpoint, "PUT", { required_status_checks: { strict: true, contexts }, enforce_admins: true,
      required_pull_request_reviews: { required_approving_review_count: 0 }, restrictions: null }, exec);
    return;
  }
  const checks: { context: string; app_id?: number }[] = old.required_status_checks?.checks
    ? old.required_status_checks.checks.map(c => ({ context: c.context, app_id: c.app_id ?? -1 }))
    : (old.required_status_checks?.contexts ?? []).map(context => ({ context }));
  for (const context of contexts) if (!checks.some(c => c.context === context)) checks.push({ context });
  await github(state.repository, `${endpoint}/required_status_checks`, "PATCH", { strict: old.required_status_checks?.strict ?? true, checks }, exec);
  if (!old.required_pull_request_reviews) await github(state.repository, `${endpoint}/required_pull_request_reviews`, "PATCH", { required_approving_review_count: 0 }, exec);
}

export async function ensureDeployKey(state: State, env: Environment, request: Request, exec: Run = run) {
  if ((await secretNames(state.repository, env, exec)).has("CONVEX_DEPLOY_KEY")) return;
  const backend = state.backends[env]; if (!backend) throw Error(`Missing ${env} backend`);
  const name = `github-${state.repository.replace("/", "-")}-${env}`;
  const existing = await request<{ name: string }[]>(`/deployments/${backend.name}/list_deploy_keys`);
  if (existing.some(key => key.name === name)) throw Error(`Convex key ${name} already exists but its GitHub secret is missing. Restore it with gh secret set CONVEX_DEPLOY_KEY --repo ${state.repository} --env ${env}, or revoke the orphan in https://dashboard.convex.dev before resuming. No duplicate key was created.`);
  const key = (await request<{ deployKey: string }>(`/deployments/${backend.name}/create_deploy_key`, "POST", { name })).deployKey;
  if (!key.startsWith(`prod:${backend.name}|`)) throw Error(`The ${env} key does not target ${backend.name}; value withheld.`);
  await storeSecret(state.repository, "CONVEX_DEPLOY_KEY", key, env, exec);
}
