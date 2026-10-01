import { randomUUID, createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
export type Environment = "staging" | "production";
export type App = "web" | "admin" | "landing" | "landing-static";
export type Project = { id: string; name: string; domain: string };
export type Backend = { id: number; name: string; url: string };
export type State = { schema: 1; repository: string; branch: string; prefix: string; team: string; convexTeam: string;
  projects: Partial<Record<`${App}/${Environment}`, Project>>; backends: Partial<Record<Environment, Backend>>; proof?: string; request?: { id: string; sha: string; context?: string } };
export const STATE_FILE = ".deploy-setup.json";
export const ENVIRONMENTS: Environment[] = ["staging", "production"];
export function apps(root: string): App[] {
  const landing = existsSync(path.join(root, "apps/landing/package.json")) ? "landing" : "landing-static";
  for (const dir of ["apps/web", "platform/apps/admin", `apps/${landing}`]) {
    if (!existsSync(path.join(root, dir, "package.json"))) throw Error(`Missing deployment app: ${dir}`);
  }
  return ["web", "admin", landing];
}
export function settings(app: App) {
  return { rootDirectory: app === "admin" ? "platform/apps/admin" : `apps/${app}`,
    framework: app === "landing-static" ? null : "nextjs", outputDirectory: app === "landing-static" ? "out" : null,
    buildCommand: "bun run build", installCommand: "bun install --frozen-lockfile", nodeVersion: "24.x" };
}
export function secretName(app: App, env: Environment): string {
  return `VERCEL_PROJECT_ID_${app.toUpperCase().replaceAll("-", "_")}${env === "staging" ? "_STAGING" : ""}`;
}
export function values(state: State, installed: App[], env: Environment) {
  const origin = (app: App) => {
    const project = state.projects[`${app}/${env}`];
    if (!project) throw Error(`Missing project ${app}/${env}`);
    return `https://${project.domain}`;
  };
  const backend = state.backends[env];
  if (!backend) throw Error(`Missing Convex ${env}`);
  const site = backend.url.replace(/\.convex\.cloud$/, ".convex.site");
  const landing = installed.includes("landing") ? "landing" : "landing-static";
  return {
    vercel: {
      web: { CONVEX_URL: backend.url, CONVEX_SITE_URL: site, LANDING_URL: origin(landing), APP_ENVIRONMENT: env },
      admin: { CONVEX_URL: backend.url, CONVEX_SITE_URL: site, APP_ENVIRONMENT: env },
      [landing]: { NEXT_PUBLIC_SITE_URL: origin(landing), NEXT_PUBLIC_WEB_APP_URL: origin("web") },
    } as Partial<Record<App, Record<string, string>>>,
    convex: { SITE_URL: `${origin("web")},${origin("admin")}`, ADMIN_SITE_URL: origin("admin"), LANDING_URL: origin(landing) },
  };
}
export function safePath(root: string, file: string): string {
  const target = path.join(root, file);
  try { if (lstatSync(target).isSymbolicLink()) throw Error(`Refusing symlink: ${file}`); }
  catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  return target;
}
/** Explicitly project public fields; arbitrary JSON and credential fields never survive a save. */
export function validateState(raw: State): State {
  if (raw.schema !== 1 || !/^[\w.-]+\/[\w.-]+$/.test(raw.repository) || !/^[a-z0-9][a-z0-9-]{0,35}$/.test(raw.prefix)
    || !/^[\w.-]+$/.test(raw.team) || !/^\d+$/.test(raw.convexTeam) || !raw.branch || /[\s~^:?*[\\]/.test(raw.branch)) throw Error("Invalid deployment setup state; check repository, branch and team IDs");
  const clean: State = { schema: 1, repository: raw.repository, branch: raw.branch, prefix: raw.prefix, team: raw.team, convexTeam: raw.convexTeam, projects: {}, backends: {} };
  for (const [key, p] of Object.entries(raw.projects ?? {})) {
    if (!/^(web|admin|landing|landing-static)\/(staging|production)$/.test(key) || !/^prj_[\w]+$/.test(p.id) || !/^[a-z0-9-]+$/.test(p.name) || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(p.domain)) throw Error("Invalid public project mapping");
    clean.projects[key as keyof State["projects"]] = { id: p.id, name: p.name, domain: p.domain };
  }
  const projectIds = Object.values(clean.projects).map(project => project.id);
  if (new Set(projectIds).size !== projectIds.length) throw Error("Each app/environment needs a separate Vercel project");
  for (const env of ENVIRONMENTS) {
    const b = raw.backends?.[env];
    if (b) {
      if (!Number.isSafeInteger(b.id) || !/^[a-z0-9-]+$/.test(b.name) || !/^https:\/\/[a-z0-9.-]+\.convex\.cloud$/.test(b.url)) throw Error("Invalid public Convex mapping");
      clean.backends[env] = { id: b.id, name: b.name, url: b.url };
    }
  }
  if (clean.backends.staging && clean.backends.production && clean.backends.staging.id === clean.backends.production.id) throw Error("Staging and production need separate Convex projects");
  if (raw.proof && /^\d+$/.test(raw.proof)) clean.proof = raw.proof;
  if (raw.request) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(raw.request.id) || !/^[a-f0-9]{40}$/.test(raw.request.sha)) throw Error("Invalid staging request");
    if (raw.request.context && !/^[a-f0-9]{64}$/.test(raw.request.context)) throw Error("Invalid staging context");
    clean.request = { id: raw.request.id, sha: raw.request.sha, ...(raw.request.context ? { context: raw.request.context } : {}) };
  }
  return clean;
}
export function readPublicFile(root: string, name: string): string | undefined {
  let fd: number;
  try { fd = openSync(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return undefined; throw Error(`Cannot safely open ${name}`, { cause: error }); }
  try { if (!fstatSync(fd).isFile()) throw Error(`Expected a regular file: ${name}`); return readFileSync(fd, "utf8"); }
  finally { closeSync(fd); }
}
export function writePublicFile(root: string, name: string, text: string): void {
  const file = safePath(root, name), temp = path.join(root, `${name}.${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    try { writeFileSync(fd, text); } finally { closeSync(fd); }
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}
export function loadState(root: string): State | undefined {
  const text = readPublicFile(root, STATE_FILE);
  if (text === undefined) return undefined;
  try { return validateState(JSON.parse(text)); } catch { throw Error("Invalid public deployment setup state; inspect .deploy-setup.json without sharing credentials."); }
}
export function saveState(root: string, state: State): void {
  writePublicFile(root, STATE_FILE, `${JSON.stringify(validateState(state), null, 2)}\n`);
}

export function ciApps(root: string): App[] {
  const selected = apps(root);
  return [...selected, ...(["landing", "landing-static"] as const).filter(app => !selected.includes(app) && existsSync(path.join(root, `apps/${app}/package.json`)))];
}
export function proofContext(state: State, installed: App[]): string {
  return createHash("sha256").update(JSON.stringify({ repository: state.repository, branch: state.branch, team: state.team,
    backend: state.backends.staging, apps: [...installed].sort().map(app => [app, state.projects[`${app}/staging`]]) })).digest("hex");
}
