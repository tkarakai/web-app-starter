import { execFile, spawn } from "node:child_process";
import { HttpApi, type Fetcher } from "./api";
import { githubToken } from "./config";
import { OpsError, redact } from "./errors";
import type { Api, Result, PageReport } from "./types";

export type Provider = "github" | "vercel";
export type Log = (message: string) => void;
export interface CommandResult { stdout: string; stderr: string; exitCode: number }
export type Runner = (file: string, args: string[], signal?: globalThis.AbortSignal) => Promise<CommandResult>;
export const runCaptured: Runner = (file, args, signal) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { signal, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
    if (error && typeof error.code !== "number") {
      reject(new OpsError(error.code === "ENOENT" ? "CLI_MISSING" : "CLI_PROCESS",
        `Could not run ${file}: ${redact(error.message)}`,
        error.code === "ENOENT" ? `Install ${file === "vercel" ? "Vercel CLI: npm install -g vercel@latest" : "GitHub CLI: https://cli.github.com"}, then rerun ops setup.` : "The CLI timed out or could not complete. Check connectivity and rerun with --debug.",
        1, { provider: file === "vercel" ? "vercel" : "github", stderr: redact(stderr) }, { cause: error }));
    } else resolve({ stdout, stderr, exitCode: error?.code as number ?? 0 });
  });
  child.stdin?.end(); // A read must never wait for login/input.
});

export function vercelSessionFetcher(run: Runner = runCaptured, log: Log = () => {}): Fetcher {
  async function request(url: URL, scope?: string, signal?: globalThis.AbortSignal): Promise<Response> {
    const path = url.pathname + url.search;
    const result = await run("vercel", ["api", path, "--method", "GET", "--raw", "--include", "--non-interactive", ...(scope ? ["--scope", scope] : [])], signal);
    // --include is a stable HTTP status/header block on stdout, even on CLI versions
    // that return nonzero for HTTP failures. Never parse human tables as API data.
    const match = result.stdout.match(/^HTTP (\d{3})[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
    if (match) {
      const status = Number(match[1]);
      if (result.exitCode === 0 || status >= 400) {
        if (result.stderr.trim()) log(`vercel CLI: ${redact(result.stderr.trim())}`);
        const headers = new Headers();
        for (const line of match[2].split(/\r?\n/)) {
          const colon = line.indexOf(":");
          if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
        }
        return new Response([204, 205, 304].includes(status) ? null : match[3], { status, headers });
      }
    }
    const diagnostic = redact(result.stderr.trim());
    const auth = /no existing credentials|not (?:logged|signed) in|log ?in|login|authentication|token.*(?:invalid|expired)|(?:invalid|expired).*token/i.test(diagnostic);
    const outdated = /unknown (?:option|command)|unexpected argument|not supported/i.test(diagnostic);
    throw new OpsError(auth ? "AUTH" : outdated ? "CLI_UNSUPPORTED" : result.exitCode ? "CLI_COMMAND" : "INVALID_RESPONSE",
      `Vercel CLI ${result.exitCode ? "failed" : "returned an unrecognized API response"}${diagnostic ? `: ${diagnostic}` : "."}`,
      auth ? "Run bun run ops auth login vercel (or vercel login), then retry. Check team access if authentication succeeds."
        : outdated ? "Update Vercel CLI: npm install -g vercel@latest. ops requires vercel api --raw --include --non-interactive."
          : "Run bun run ops auth status and check team access/connectivity. Update Vercel CLI if its API output format changed.",
      1, { provider: "vercel", path: url.pathname, exitCode: result.exitCode, stderr: diagnostic });
  }
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== "https://api.vercel.com" || (init?.method ?? "GET") !== "GET") {
      throw new OpsError("INVALID_URL", "The Vercel CLI session transport only accepts Vercel API reads.", "Use the deployment workflow commands for writes.");
    }
    const scope = url.searchParams.get("teamId") || undefined;
    if (!scope && !["/v2/user", "/v2/teams"].includes(url.pathname)) {
      throw new OpsError("CONFIG_MISSING", "A Vercel team must be selected for project and deployment queries.",
        "Run bun run ops setup, or bun run ops teams and bun run ops projects --team ID_OR_SLUG. Set teamId in ops.config.json for status queries. The Vercel CLI does not support a personal-account scope.", 2, { provider: "vercel", missing: "teamId" });
    }
    // Older CLIs overwrite query teamId with their selected team. --scope pins it.
    return request(url, scope, init?.signal ?? undefined);
  };
}
export function vercelApi(log: Log = () => {}, signal?: globalThis.AbortSignal): Api {
  return process.env.VERCEL_TOKEN
    ? new HttpApi("vercel", process.env.VERCEL_TOKEN, log, undefined, undefined, signal)
    : new HttpApi("vercel", "", log, vercelSessionFetcher(runCaptured, log), undefined, signal);
}
export function githubApi(log: Log = () => {}, signal?: globalThis.AbortSignal): Api {
  let client: Promise<Api> | undefined;
  const getClient = () => client ??= githubToken().then(token => new HttpApi("github", token, log, undefined, undefined, signal));
  return {
    get: async <T>(path: string) => (await getClient()).get<T>(path),
    post: async <T>(path: string, body: unknown) => (await getClient()).post<T>(path, body),
    pages: async <T>(path: string, key?: string, limit?: number, report?: PageReport) => (await getClient()).pages<T>(path, key, limit, report),
  };
}
export function authSource(provider: Provider): string {
  return provider === "github" ? process.env.GH_TOKEN ? "GH_TOKEN" : process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : "gh session"
    : process.env.VERCEL_TOKEN ? "VERCEL_TOKEN" : "vercel session";
}
export async function account(provider: Provider, log: Log = () => {}): Promise<Record<string, unknown>> {
  const source = authSource(provider);
  if (provider === "github") {
    const user = await new HttpApi("github", await githubToken(), log).get<{ login: string }>("/user");
    if (typeof user?.login !== "string" || !user.login) throw new OpsError("INVALID_RESPONSE", "GitHub did not return an account login.", "Retry ops auth status with --debug.");
    return { provider, source, account: user.login, state: "authenticated" };
  }
  const { user } = await vercelApi(log).get<{ user: { username: string } }>("/v2/user");
  if (typeof user?.username !== "string" || !user.username) throw new OpsError("INVALID_RESPONSE", "Vercel did not return an account username.", "Retry ops auth status with --debug.");
  return { provider, source, account: user.username, state: "authenticated" };
}
export async function authStatus(log: Log = () => {}, check = account): Promise<{ data: Result; errors: unknown[] }> {
  const providers: Provider[] = ["github", "vercel"];
  const checks = await Promise.allSettled(providers.map(p => check(p, log)));
  const errors: unknown[] = [];
  const rows = checks.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    errors.push(result.reason);
    return { provider: providers[i], source: authSource(providers[i]), state: "failed" };
  });
  return { data: { rows }, errors };
}
export function requireInteractive(json: boolean) {
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) throw new OpsError("INTERACTIVE_REQUIRED",
    "Login and guided setup require an interactive terminal without --json.",
    "In a terminal run bun run ops setup, or gh auth login --hostname github.com and vercel login. Agents can use ops auth status --json, ops teams --json, and ops projects --team TEAM_ID --json; supply GH_TOKEN/VERCEL_TOKEN via a secret manager in CI.", 2);
}
export async function login(provider: Provider): Promise<void> {
  const source = authSource(provider);
  if (source.endsWith("TOKEN")) throw new OpsError("AUTH_OVERRIDE", `${source} overrides the ${provider} CLI session.`, `Unset ${source} to use CLI login, or update the environment credential through your secret manager.`, 2);
  const file = provider === "github" ? "gh" : "vercel";
  const args = provider === "github" ? ["auth", "login", "--hostname", "github.com", "--web"] : ["login"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit" });
    child.once("error", cause => reject(new OpsError("CLI_MISSING", `Cannot start ${file}: ${cause.message}`, `Install ${file === "gh" ? "GitHub CLI from https://cli.github.com" : "Vercel CLI with npm install -g vercel@latest"}, then retry.`, 1, { provider }, { cause })));
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new OpsError("LOGIN_FAILED", `${file} login did not complete (${signal ?? code}).`, `Rerun ops auth login ${provider}.`, signal === "SIGINT" ? 130 : 1, { provider, code, signal })));
  });
}
export interface Team extends Record<string, unknown> { id: string; slug: string; name: string }
export async function teams(api: Api): Promise<Team[]> {
  return (await api.pages<Team>("/v2/teams", "teams")).map(({ id, slug, name }) => ({ id, slug, name }));
}
export async function resolveTeam(api: Api, value: string): Promise<string> {
  const match = (await teams(api)).find(t => t.id === value || t.slug === value);
  if (!match) throw new OpsError("TEAM_NOT_FOUND", `No accessible Vercel team matches ${value}.`, "Run ops teams to list team IDs and slugs, or check ops auth status.", 2);
  return match.id;
}
export interface Project extends Record<string, unknown> { id: string; name: string }
export async function projects(api: Api, teamId?: string): Promise<Project[]> {
  return (await api.pages<Project>(`/v9/projects${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`, "projects")).map(({ id, name }) => ({ id, name }));
}
