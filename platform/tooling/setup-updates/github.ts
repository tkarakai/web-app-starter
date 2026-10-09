import { createPrivateKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { demand } from "../platform-upgrade/metadata.ts";

export const PERMISSIONS = { contents: "write", pull_requests: "write", workflows: "write", issues: "write" } as const;
export type App = { id: number; slug: string; pem: string };
export type Repository = { id: number; full_name: string; owner: { login: string; type: "User" | "Organization" }; permissions: { admin: boolean } };
export type Api = (method: string, endpoint: string, token?: string, body?: unknown) => Promise<unknown>;
export type Gh = (args: string[], input?: string) => string;
export const gh: Gh = (args, input) => {
  try { return execFileSync("gh", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }); }
  catch { throw new Error("GitHub CLI could not complete " + args.slice(0, 2).join(" ") + ". Check gh auth status and repository administration access."); }
};
export const api: Api = async (method, endpoint, token, body) => {
  demand(/^\/[A-Za-z0-9_./-]+$/.test(endpoint) && !endpoint.includes(".."), "Invalid GitHub API endpoint");
  const response = await fetch("https://api.github.com" + endpoint, { method, redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "web-app-starter-setup-updates", ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  demand(response.ok, "GitHub setup request failed (HTTP " + response.status + "). No response credentials were logged.");
  if (response.status === 204) return null;
  demand(response.body, "Empty GitHub setup response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const row = await reader.read(); if (row.done) break; size += row.value.length; demand(size <= 256 * 1024, "Oversized GitHub setup response"); chunks.push(row.value); } }
  finally { await reader.cancel(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Error("GitHub setup returned invalid JSON; response contents were omitted."); }
};
function object(value: unknown): Record<string, unknown> { demand(value !== null && typeof value === "object" && !Array.isArray(value), "Malformed GitHub setup response"); return value as Record<string, unknown>; }
export function parseApp(value: unknown): App {
  const row = object(value);
  demand(Number.isSafeInteger(row.id) && Number(row.id) > 0 && typeof row.slug === "string" && /^[a-z0-9-]+$/.test(row.slug), "Invalid GitHub App identity");
  demand(typeof row.pem === "string" && row.pem.length <= 32 * 1024, "Missing GitHub App private key");
  try { demand(createPrivateKey(row.pem).asymmetricKeyType === "rsa", "GitHub App key is not RSA"); } catch { throw Error("Invalid GitHub App private key; its value was omitted."); }
  return { id: Number(row.id), slug: row.slug, pem: row.pem };
}
export function appJWT(app: App, now = Math.floor(Date.now() / 1000)): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = encode({ alg: "RS256", typ: "JWT" }) + "." + encode({ iat: now - 60, exp: now + 540, iss: String(app.id) });
  return data + "." + sign("RSA-SHA256", Buffer.from(data), app.pem).toString("base64url");
}
export function repository(value: unknown): Repository {
  const row = object(value), owner = object(row.owner), permissions = object(row.permissions);
  demand(Number.isSafeInteger(row.id) && typeof row.full_name === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.full_name), "Invalid repository identity");
  demand(typeof owner.login === "string" && ["User", "Organization"].includes(String(owner.type)) && row.full_name.split("/")[0].toLowerCase() === owner.login.toLowerCase(), "Invalid repository owner");
  demand(permissions.admin === true, "Repository administration access is required to configure updater credentials");
  return { id: Number(row.id), full_name: row.full_name, owner: { login: owner.login, type: owner.type as Repository["owner"]["type"] }, permissions: { admin: true } };
}
/** Verify the App's real installation, never merely the untrusted browser callback ID. */
export async function verifyInstallation(app: App, repo: Repository, request: Api = api): Promise<void> {
  const jwt = appJWT(app), installation = object(await request("GET", "/repos/" + repo.full_name + "/installation", jwt));
  demand(installation.app_id === app.id && Number.isSafeInteger(installation.id) && installation.repository_selection === "selected", "Install this App on the selected app repository only");
  const permissions = object(installation.permissions);
  // Owners may separately consent to read-only enforcement inspection for named maintenance
  // auto-merge. The registration manifest does not request it and setup never upgrades grants.
  demand(Object.entries(PERMISSIONS).every(([name, level]) => permissions[name] === level)
    && Object.keys(permissions).every(name => ["metadata", "administration", "checks", "variables"].includes(name) && permissions[name] === "read"
      || Object.hasOwn(PERMISSIONS, name)), "App installation permissions differ from the requested updater permissions");
  const token = object(await request("POST", "/app/installations/" + installation.id + "/access_tokens", jwt, { permissions: { metadata: "read" } }));
  demand(typeof token.token === "string" && token.token.length > 0, "Missing installation verification token");
  try {
    const repositories = object(await request("GET", "/installation/repositories", token.token));
    demand(repositories.total_count === 1 && Array.isArray(repositories.repositories) && repositories.repositories.length === 1 && object(repositories.repositories[0]).id === repo.id, "Select only " + repo.full_name + " in the App installation");
  } finally { await request("DELETE", "/installation/token", token.token); }
}
export function configured(repo: string, run: Gh = gh): { id?: string; key: boolean } {
  const variables = JSON.parse(run(["variable", "list", "--repo", repo, "--json", "name,value"])) as { name: string; value: string }[];
  const secrets = JSON.parse(run(["secret", "list", "--repo", repo, "--json", "name"])) as { name: string }[];
  return { id: variables.find(row => row.name === "PLATFORM_UPDATER_APP_ID")?.value, key: secrets.some(row => row.name === "PLATFORM_UPDATER_PRIVATE_KEY") };
}
export function storeApp(app: App, repo: string, run: Gh = gh): void {
  // PEM only travels over stdin into gh's encrypted repository-secret transport.
  run(["secret", "set", "PLATFORM_UPDATER_PRIVATE_KEY", "--repo", repo], app.pem);
  try { run(["variable", "set", "PLATFORM_UPDATER_APP_ID", "--repo", repo, "--body", String(app.id)]); }
  catch { throw Error("The private key was stored, but setting PLATFORM_UPDATER_APP_ID failed. Set that variable to " + app.id + " before running updates."); }
}
