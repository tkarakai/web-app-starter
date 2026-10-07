/** Compatibility API for the original MCP-only controls. */
import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import { adminMutation, authedQuery } from "./functions";
import { surfaceConfiguration, changeSurface } from "./agentSurfaces";
export const mcpConfiguration = (ctx: Pick<QueryCtx, "runQuery">) => surfaceConfiguration(ctx, "mcp");
export const availability = query({ args: {}, handler: async ctx => ({ enabled: (await mcpConfiguration(ctx)).enabled }) });
export const configuration = authedQuery({ args: {}, handler: async ctx => ctx.user.role === "admin" ? { enabled: (await mcpConfiguration(ctx)).enabled, configured: Boolean(process.env.AGENT_MCP_RESOURCE && process.env.AGENT_MCP_AUTH_ORIGIN) } : null });
export const setEnabled = adminMutation({ args: { enabled: v.boolean() }, handler: async (ctx, { enabled }) => changeSurface(ctx, "mcp", enabled) });
