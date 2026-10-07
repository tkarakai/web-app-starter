/** Session-bound OAuth grant storage. Raw credentials are never stored. */
import { v } from "convex/values";
import { query, mutation, type QueryCtx } from "../_generated/server";
import { adminMutation } from "./functions";
import { readSession, evaluateSession } from "./sessionPolicy";
import { rateLimit } from "./rateLimits";

export const AGENT_CLIENT_ID = "pi-announcements";
export const AGENT_SCOPE = "announcements:manage";

export async function credentialHash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function secret(): string { return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); }
function resourceEnabled(resource: string): boolean {
  return Boolean(process.env.AGENT_MCP_RESOURCE && resource === process.env.AGENT_MCP_RESOURCE);
}
export function validRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && Boolean(url.port)
      && url.pathname === "/callback" && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export const authorize = adminMutation({
  args: { clientId: v.string(), redirectUri: v.string(), resource: v.string(), challenge: v.string(), scope: v.string() },
  handler: async (ctx, args) => {
    if (args.clientId !== AGENT_CLIENT_ID || args.scope !== AGENT_SCOPE || !resourceEnabled(args.resource)
      || !validRedirect(args.redirectUri) || !/^[A-Za-z0-9_-]{43}$/.test(args.challenge)) throw new Error("INVALID_AUTHORIZATION_REQUEST");
    const code = secret();
    await ctx.db.insert("agentAuthorizationCodes", {
      codeHash: await credentialHash(code), userId: ctx.user._id, sessionId: ctx.session._id,
      ...args, expiresAt: Date.now() + 60_000,
    });
    return { code };
  },
});

export async function requireGrant(ctx: QueryCtx, token: string, resource: string, recent = false) {
  if (!resourceEnabled(resource)) throw new Error("INVALID_AGENT_TOKEN");
  const tokenHash = await credentialHash(token);
  const grant = await ctx.db.query("agentGrants").withIndex("by_token_hash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!grant || grant.revokedAt || grant.expiresAt <= Date.now() || grant.resource !== resource || grant.scope !== AGENT_SCOPE)
    throw new Error("INVALID_AGENT_TOKEN");
  const pair = await readSession(ctx, grant.userId, grant.sessionId);
  if (!pair || pair.user.role !== "admin") throw new Error("INVALID_AGENT_TOKEN");
  const assurance = await evaluateSession(ctx, pair);
  if (!assurance.allowed) throw new Error("INVALID_AGENT_TOKEN");
  if (recent && !assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  return { ...pair, assurance, ownerId: (pair.user.userId ?? pair.user._id).toString() };
}

export const exchange = mutation({
  args: { code: v.string(), verifier: v.string(), clientId: v.string(), redirectUri: v.string(), resource: v.string() },
  handler: async (ctx, args) => {
    await rateLimit(ctx, { name: "mutationGlobal", key: `agent-exchange:${await credentialHash(args.code)}`, throws: true });
    const hash = await credentialHash(args.code);
    const row = await ctx.db.query("agentAuthorizationCodes").withIndex("by_code_hash", q => q.eq("codeHash", hash)).unique();
    if (!row || row.expiresAt <= Date.now() || !resourceEnabled(args.resource) || row.resource !== args.resource
      || row.clientId !== args.clientId || row.redirectUri !== args.redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(args.verifier)) throw new Error("INVALID_GRANT");
    const challengeBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(args.verifier)));
    const challenge = btoa(String.fromCharCode(...challengeBytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    if (challenge !== row.challenge) throw new Error("INVALID_GRANT");
    const pair = await readSession(ctx, row.userId, row.sessionId);
    if (!pair || pair.user.role !== "admin") throw new Error("INVALID_GRANT");
    const assurance = await evaluateSession(ctx, pair);
    if (!assurance.allowed || !assurance.recent) throw new Error("INVALID_GRANT");
    // A mutation atomically consumes the code. Racing or repeated exchanges cannot mint two tokens.
    await ctx.db.delete(row._id);
    const token = secret();
    const expiresAt = Math.min(Date.now() + 15 * 60_000, assurance.expiresAt);
    await ctx.db.insert("agentGrants", { tokenHash: await credentialHash(token), userId: row.userId, sessionId: row.sessionId,
      resource: row.resource, scope: row.scope, clientId: row.clientId, expiresAt, createdAt: Date.now() });
    return { access_token: token, token_type: "Bearer", expires_in: Math.floor((expiresAt - Date.now()) / 1000), scope: row.scope };
  },
});
export const inspect = query({
  args: { token: v.string(), resource: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireGrant(ctx, args.token, args.resource);
    return { scope: AGENT_SCOPE, recent: auth.assurance.recent };
  },
});
export const listMine = query({
  args: {},
  handler: async ctx => {
    const { authorizedSession } = await import("./sessionPolicy");
    const auth = await authorizedSession(ctx);
    if (!auth || auth.user.role !== "admin") return [];
    const grants = await ctx.db.query("agentGrants").withIndex("by_user", q => q.eq("userId", auth.user._id)).collect();
    return grants.map(({ _id, createdAt, expiresAt, revokedAt, clientId }) => ({ _id, createdAt, expiresAt, revokedAt, clientId }));
  },
});
export const revoke = adminMutation({
  args: { grantId: v.id("agentGrants") },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.userId !== ctx.user._id) throw new Error("GRANT_NOT_FOUND");
    await ctx.db.patch(grant._id, { revokedAt: Date.now() });
  },
});
