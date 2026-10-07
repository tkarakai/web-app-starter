import { v } from "convex/values";
import { components } from "../_generated/api";
import { query, type QueryCtx } from "../_generated/server";
import { adminMutation, authedQuery } from "./functions";

const KEY = "agentMcpConfiguration";
export async function mcpConfiguration(ctx: Pick<QueryCtx, "runQuery">) {
  const row = await ctx.runQuery(components.platform.appSettings.getRaw, { key: KEY });
  if (row) {
    try {
      const value = JSON.parse(row.value) as { enabled?: unknown; generation?: unknown };
      if (typeof value.enabled === "boolean" && typeof value.generation === "string") return { enabled: value.enabled, generation: value.generation };
    } catch { /* Invalid configuration fails closed. */ }
  }
  return { enabled: false, generation: "unconfigured" };
}
/** Public availability only; no user, grant or secret information. */
export const availability = query({ args: {}, handler: async ctx => ({ enabled: (await mcpConfiguration(ctx)).enabled }) });
export const configuration = authedQuery({
  args: {}, handler: async ctx => {
    if (ctx.user.role !== "admin") return null;
    const value = await mcpConfiguration(ctx);
    return { enabled: value.enabled, configured: Boolean(process.env.AGENT_MCP_RESOURCE && process.env.AGENT_MCP_AUTH_ORIGIN) };
  },
});
export const setEnabled = adminMutation({
  args: { enabled: v.boolean() }, handler: async (ctx, { enabled }) => {
    const previous = await mcpConfiguration(ctx);
    if (previous.enabled === enabled) return;
    const next = { enabled, generation: crypto.randomUUID() };
    await ctx.runMutation(components.platform.appSettings.putRaw, { key: KEY, value: JSON.stringify(next) });
    await ctx.runMutation(components.platform.auditTrail.insertEvent, {
      happenedAt: Date.now(), actor: ctx.user.email, authenticatedUserId: ctx.ownerId,
      source: "server:agent-mcp", action: enabled ? "admin.mcp_enabled" : "admin.mcp_disabled", resource: "agent-mcp", status: "succeeded",
    });
  },
});
