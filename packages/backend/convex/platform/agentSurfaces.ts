import { LEGACY_APP_OPERATOR_AGENT_SURFACE_AUDIT_SOURCE } from "./appOperatorAuditCompatibility";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { query, type QueryCtx, type MutationCtx } from "../_generated/server";
import { appOperatorMutation, authedQuery } from "./functions";
export const surfaceValidator = v.union(v.literal("mcp"), v.literal("cli"), v.literal("webmcp"), v.literal("a2a"));
export type AgentSurface = "mcp" | "cli" | "webmcp" | "a2a";
const keys: Record<AgentSurface, string> = { mcp: "agentMcpConfiguration", cli: "agentCliConfiguration", webmcp: "agentWebMcpConfiguration", a2a: "agentA2aConfiguration" };
export async function surfaceConfiguration(ctx: Pick<QueryCtx, "runQuery">, surface: AgentSurface) {
  const row = await ctx.runQuery(components.platform.appSettings.getRaw, { key: keys[surface] });
  if (row) {
    try {
      const value = JSON.parse(row.value) as { enabled?: unknown; generation?: unknown };
      if (typeof value.enabled === "boolean" && typeof value.generation === "string") return { enabled: value.enabled, generation: value.generation };
    } catch { /* Fail closed. */ }
  }
  return { enabled: false, generation: "unconfigured" };
}
export function surfaceForResource(resource: string): AgentSurface | null {
  const mcp = process.env.AGENT_MCP_RESOURCE;
  if (!mcp || !mcp.endsWith("/api/mcp")) return null;
  const origin = mcp.slice(0, -8);
  if (resource === mcp) return "mcp";
  if (resource === `${origin}/api/agent/cli`) return "cli";
  if (resource === `${origin}/api/a2a`) return "a2a";
  return null;
}
export const availability = query({ args: { surface: surfaceValidator }, handler: async (ctx, { surface }) => ({ enabled: (await surfaceConfiguration(ctx, surface)).enabled }) });
export const configuration = authedQuery({
  args: {}, handler: async ctx => {
    if (ctx.user.role !== "admin") return null;
    const states = await Promise.all((Object.keys(keys) as AgentSurface[]).map(async surface => [surface, await surfaceConfiguration(ctx, surface)] as const));
    return { surfaces: Object.fromEntries(states), configured: Boolean(process.env.AGENT_MCP_RESOURCE && process.env.AGENT_MCP_AUTH_ORIGIN) };
  },
});
export async function changeSurface(ctx: MutationCtx & { user: { email: string }; ownerId: string }, surface: AgentSurface, enabled: boolean) {
  const previous = await surfaceConfiguration(ctx, surface);
  if (previous.enabled === enabled) return;
  await ctx.runMutation(components.platform.appSettings.putRaw, { key: keys[surface], value: JSON.stringify({ enabled, generation: crypto.randomUUID() }) });
  await ctx.runMutation(components.platform.auditTrail.insertEvent, {
    happenedAt: Date.now(), actor: ctx.user.email, authenticatedUserId: ctx.ownerId,
    source: LEGACY_APP_OPERATOR_AGENT_SURFACE_AUDIT_SOURCE, action: surface === "mcp" ? enabled ? "admin.mcp_enabled" : "admin.mcp_disabled" : enabled ? "admin.agent_surface_enabled" : "admin.agent_surface_disabled",
    resource: `agent-${surface}`, status: "succeeded",
  });
}
export const setEnabled = appOperatorMutation({ args: { surface: surfaceValidator, enabled: v.boolean() }, handler: async (ctx, { surface, enabled }) => changeSurface(ctx, surface, enabled) });
