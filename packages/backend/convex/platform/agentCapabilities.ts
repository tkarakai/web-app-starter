import { catalogueFromRows, searchCapabilities, describeCapabilities, gatewaySchemas } from "@web-app-starter/agentic/discovery";
import { withBrowserCapabilities } from "@web-app-starter/agentic/browser-catalogue";
/** Surface-neutral execution. Only the explicit registry is callable, never arbitrary Convex exports. */
import { v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "../_generated/server";
import { requireGrant } from "./agentAccess";
import { authorizedSession } from "./sessionPolicy";
import { surfaceConfiguration } from "./agentSurfaces";
import { rateLimit } from "./rateLimits";
import { catalogueRows, capabilityRegistry, workflowResult, sanitizeNativeResult } from "./agentRegistry";
import { invokeNative, nativeDefinition } from "./nativeCapabilities";
const args = { name: v.string(), input: v.any() };
const credentialArgs = { token: v.string(), resource: v.string() };
const rowsValidator = v.array(v.object({ name: v.string(), title: v.string(), description: v.string(), effect: v.union(v.literal("read"), v.literal("write"), v.literal("browser"), v.literal("human")), inputSchema: v.any() }));
function entry(name: string) { const registry = capabilityRegistry(); const value = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined; if (!value) throw new Error("UNKNOWN_CAPABILITY"); return value; }
function boundInputs(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_INPUT");
  const value = input as Record<string, unknown>;
  if (JSON.stringify(value).length > 80_000) throw new Error("INPUT_TOO_LARGE");
  const pagination = value.paginationOpts as { numItems?: unknown } | undefined;
  if (pagination && (typeof pagination.numItems !== "number" || !Number.isInteger(pagination.numItems) || pagination.numItems < 1 || pagination.numItems > 100)) throw new Error("INVALID_PAGE_SIZE");
  for (const field of Object.values(value)) if (Array.isArray(field) && field.length > 100) throw new Error("BATCH_TOO_LARGE");
}
export async function runCapability(ctx: QueryCtx | MutationCtx, auth: unknown, name: string, input: unknown, write: boolean) {
  const value = entry(name); boundInputs(input);
  if (!value.registered) {
    if (write || Object.keys(input as object).length) throw new Error("INVALID_INPUT");
    return workflowResult(value);
  }
  if ((nativeDefinition(value.registered).kind === "mutation") !== write) throw new Error("WRONG_EXECUTION_KIND");
  const result = await invokeNative(value.registered, ctx, auth, input);
  return sanitizeNativeResult(name, result, ctx);
}
export const catalogue = query({ args: credentialArgs, returns: rowsValidator, handler: async (ctx, { token, resource }) => { await requireGrant(ctx, token, resource); return catalogueRows(); } });
export const read = query({ args: { ...credentialArgs, ...args }, returns: v.any(), handler: async (ctx, { token, resource, name, input }) => runCapability(ctx, await requireGrant(ctx, token, resource), name, input, false) });
export const write = mutation({ args: { ...credentialArgs, ...args }, returns: v.any(), handler: async (ctx, { token, resource, name, input }) => {
  const auth = await requireGrant(ctx, token, resource, true);
  await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
  return (await runCapability(ctx, auth, name, input, true)) ?? null;
} });
async function browserAuth(ctx: QueryCtx, recent = false) {
  if (!(await surfaceConfiguration(ctx, "webmcp")).enabled) throw new Error("SURFACE_DISABLED");
  const auth = await authorizedSession(ctx);
  if (!auth || auth.user.role !== "admin") throw new Error("NOT_ADMIN");
  if (recent && !auth.assurance.recent) throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  return auth;
}
export const browserRead = query({ args, returns: v.any(), handler: async (ctx, { name, input }) => runCapability(ctx, await browserAuth(ctx), name, input, false) });
export const browserWrite = mutation({ args, returns: v.any(), handler: async (ctx, { name, input }) => {
  const auth = await browserAuth(ctx, true);
  await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
  return (await runCapability(ctx, auth, name, input, true)) ?? null;
} });

/** Browser-safe gateway: return JSON text so standard JSON Schema dollar keys remain legal. */
export const browserGateway = query({ args: { operation: v.union(v.literal("search"), v.literal("describe"), v.literal("prepare")), input: v.any(), requestId: v.string() }, returns: v.string(), handler: async (ctx, { operation, input, requestId }) => {
  await browserAuth(ctx, true);
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error("INVALID_REQUEST");
  const catalogue = withBrowserCapabilities(catalogueFromRows(catalogueRows()));
  if (operation === "search") return JSON.stringify(searchCapabilities(catalogue, input));
  if (operation === "describe") return JSON.stringify(describeCapabilities(catalogue, input));
  const request = gatewaySchemas.capabilities_execute.parse(input);
  const definition = Object.prototype.hasOwnProperty.call(catalogue, request.name) ? catalogue[request.name] : undefined;
  if (!definition) throw new Error("UNKNOWN_CAPABILITY");
  if (request.resultOffset && definition.effect !== "read") throw new Error("WRITE_OUTPUT_CANNOT_BE_REPLAYED");
  return JSON.stringify({ name: request.name, input: definition.schema.parse(request.input), effect: definition.effect, resultOffset: request.resultOffset });
} });
