/** Durable A2A tasks. Jobs store grant IDs, not raw tokens; native writes and completion commit together. */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { query, mutation, internalMutation, internalAction } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { credentialHash, requireGrant, requireGrantById } from "./agentAccess";
import { surfaceForResource } from "./agentSurfaces";
import { catalogueRows } from "./agentRegistry";
import { runCapability } from "./agentCapabilities";
import { rateLimit } from "./rateLimits";
import { catalogueFromRows, searchCapabilities, describeCapabilities, executeCapability } from "@web-app-starter/agentic/discovery";
import { withBrowserCapabilities } from "@web-app-starter/agentic/browser-catalogue";
import { messageRequest, validateCommand } from "@web-app-starter/agentic/a2a";
import { safeCapabilityError } from "@web-app-starter/agentic/errors";
const credentialArgs = { token: v.string(), resource: v.string() };
import { taskDto as dto, ownedTask as owned, taskTerminalStates as terminal, type TaskDto } from "./agentTaskModel";
const catalogue = () => withBrowserCapabilities(catalogueFromRows(catalogueRows()));
function requireAudience(resource: string) { if (surfaceForResource(resource) !== "a2a") throw new Error("INVALID_AGENT_TOKEN"); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; return JSON.stringify(value) ?? "null"; }
export const send = mutation({ args: { ...credentialArgs, params: v.any() }, returns: v.any(), handler: async (ctx, { token, resource, params }): Promise<TaskDto> => {
  requireAudience(resource); const auth = await requireGrant(ctx, token, resource);
  await rateLimit(ctx, { name: "agentRequest", key: auth.ownerId, throws: true });
  if (JSON.stringify(params).length > 80_000) throw new Error("INVALID_PARAMS");
  const request = messageRequest.parse(params);
  if (request.configuration?.taskPushNotificationConfig) throw new Error("PUSH_NOT_SUPPORTED");
  if (request.configuration?.acceptedOutputModes?.length && !request.configuration.acceptedOutputModes.includes("application/json")) throw new Error("CONTENT_TYPE_NOT_SUPPORTED");
  const dataParts = request.message.parts.filter(part => part.data !== undefined);
  if (dataParts.length > 1 || request.message.parts.some(part => Object.keys(part).some(key => ["raw", "url"].includes(key)))) throw new Error("CONTENT_TYPE_NOT_SUPPORTED");
  const command = dataParts.length ? validateCommand(dataParts[0]!.data, catalogue()) : null;
  const hash = await credentialHash(canonical({ command, contextId: request.message.contextId ?? null, taskId: request.message.taskId ?? null }));
  const replay = await ctx.db.query("agentTaskMessages").withIndex("by_user_message", q => q.eq("userId", auth.user._id).eq("messageId", request.message.messageId)).unique();
  if (replay) { if (replay.requestHash !== hash) throw new Error("MESSAGE_ID_REUSED"); return dto(await owned(ctx, auth.user._id, replay.taskId)); }
  let existing: Doc<"agentTasks"> | null = null;
  if (request.message.taskId) {
    existing = await owned(ctx, auth.user._id, request.message.taskId);
    if (request.message.contextId && request.message.contextId !== existing.contextId) throw new Error("CONTEXT_MISMATCH");
    if (terminal.has(existing.state) || existing.state !== "TASK_STATE_INPUT_REQUIRED") throw new Error("TASK_NOT_CONTINUABLE");
    const messages = await ctx.db.query("agentTaskMessages").withIndex("by_task", q => q.eq("taskId", existing!._id)).take(13);
    if (messages.length >= 12) throw new Error("TASK_MESSAGE_LIMIT");
  } else {
    const tasks = await ctx.db.query("agentTasks").withIndex("by_user", q => q.eq("userId", auth.user._id)).filter(q => q.gt(q.field("expiresAt"), Date.now())).take(201);
    if (tasks.length >= 200) throw new Error("TASK_LIMIT_REACHED");
  }
  const generation = auth.generation; if (!generation) throw new Error("INVALID_AGENT_TOKEN");
  const now = Date.now(); const expiresAt = existing?.expiresAt ?? now + 86_400_000;
  const state = command ? "TASK_STATE_SUBMITTED" : "TASK_STATE_INPUT_REQUIRED";
  const error = command ? undefined : "This worker requires one structured data part: {operation:'search|describe|execute',input:{...}}. Use the pi tester to plan conversational requests. Never send passwords or authentication codes.";
  const fields = { userId: auth.user._id, grantId: auth.grantId, resource, generation, contextId: existing?.contextId ?? request.message.contextId ?? crypto.randomUUID(), messageId: request.message.messageId, requestHash: hash, command: command ? JSON.stringify(command) : undefined, state, createdAt: existing?.createdAt ?? now, updatedAt: now, expiresAt, result: undefined, error };
  const taskId = existing?._id ?? await ctx.db.insert("agentTasks", fields);
  if (existing) await ctx.db.patch(taskId, fields);
  await ctx.db.insert("agentTaskMessages", { userId: auth.user._id, messageId: request.message.messageId, taskId, requestHash: hash, expiresAt });
  if (!existing) await ctx.scheduler.runAfter(86_400_000, internal.platform.agentTasks.expire, { taskId });
  if (command) {
    await ctx.scheduler.runAfter(0, internal.platform.agentTasks.work, { taskId });
    await ctx.scheduler.runAfter(15_000, internal.platform.agentTasks.recover, { taskId, attempt: 1 });
  }
  return dto((await ctx.db.get(taskId))!);
} });
export const get = query({ args: { ...credentialArgs, id: v.string() }, returns: v.any(), handler: async (ctx, { token, resource, id }): Promise<TaskDto> => { requireAudience(resource); const auth = await requireGrant(ctx, token, resource); return dto(await owned(ctx, auth.user._id, id)); } });
export const list = query({ args: { ...credentialArgs, contextId: v.optional(v.string()), status: v.optional(v.string()), pageSize: v.optional(v.number()), pageToken: v.optional(v.string()), includeArtifacts: v.optional(v.boolean()), statusTimestampAfter: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => {
  requireAudience(args.resource); const auth = await requireGrant(ctx, args.token, args.resource);
  const requested = args.pageSize ?? 50; const offset = args.pageToken ? Number(args.pageToken) : 0;
  const after = args.statusTimestampAfter ? Date.parse(args.statusTimestampAfter) : 0;
  if (!Number.isInteger(requested) || requested < 1 || requested > 100 || !Number.isInteger(offset) || offset < 0 || !Number.isFinite(after)) throw new Error("INVALID_PARAMS");
  const rows = await ctx.db.query("agentTasks").withIndex("by_user", q => q.eq("userId", auth.user._id)).filter(q => q.gt(q.field("expiresAt"), Date.now())).take(201);
  const filtered = rows.filter(row => (!args.contextId || row.contextId === args.contextId) && (!args.status || row.state === args.status) && row.updatedAt >= after).sort((a, b) => b.createdAt - a.createdAt || a._id.localeCompare(b._id));
  const pageSize = Math.min(requested, args.includeArtifacts ? 3 : 50);
  return { tasks: filtered.slice(offset, offset + pageSize).map(row => dto(row, args.includeArtifacts ?? false)), nextPageToken: offset + pageSize < filtered.length ? String(offset + pageSize) : "", pageSize, totalSize: filtered.length };
} });
export const cancel = mutation({ args: { ...credentialArgs, id: v.string() }, returns: v.any(), handler: async (ctx, { token, resource, id }): Promise<TaskDto> => {
  requireAudience(resource); const auth = await requireGrant(ctx, token, resource);
  const row = await owned(ctx, auth.user._id, id); if (terminal.has(row.state)) throw new Error("TASK_NOT_CANCELABLE");
  await ctx.db.patch(row._id, { state: "TASK_STATE_CANCELED", updatedAt: Date.now(), error: "Canceled before execution committed." });
  return dto((await ctx.db.get(row._id))!);
} });
export const begin = internalMutation({ args: { taskId: v.id("agentTasks") }, returns: v.boolean(), handler: async (ctx, { taskId }) => {
  const row = await ctx.db.get(taskId); if (!row || !["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(row.state)) return false;
  await ctx.db.patch(taskId, { state: "TASK_STATE_WORKING", updatedAt: Date.now() }); return true;
} });
export const perform = internalMutation({ args: { taskId: v.id("agentTasks") }, returns: v.null(), handler: async (ctx, { taskId }) => {
  const row = await ctx.db.get(taskId); if (!row || row.state !== "TASK_STATE_WORKING" || !row.command) return;
  const definitions = catalogue(); const command = validateCommand(JSON.parse(row.command), definitions);
  const execution = command.operation === "execute" ? command.input as { name: string } : null;
  const auth = await requireGrantById(ctx, row.grantId, row.resource, Boolean(execution && definitions[execution.name]?.effect === "write"));
  if (execution && definitions[execution.name]?.effect === "write") await rateLimit(ctx, { name: "mutationGlobal", key: auth.ownerId, throws: true });
  const adapter = { async execute(name: string, input: Record<string, unknown>) { if (definitions[name]?.effect === "browser") return { status: "requires_browser", executed: false, instructions: "Use WebMCP in a connected authenticated admin page." }; return runCapability(ctx, auth, name, input, definitions[name]?.effect === "write"); } };
  const result = command.operation === "search" ? searchCapabilities(definitions, command.input) : command.operation === "describe" ? describeCapabilities(definitions, command.input) : await executeCapability(adapter, definitions, command.input);
  const outcome = (result as { result?: { status?: string; instructions?: string } }).result;
  const dependency = outcome?.status === "requires_user_action" || outcome?.status === "requires_browser";
  await ctx.db.patch(taskId, { state: dependency ? "TASK_STATE_INPUT_REQUIRED" : "TASK_STATE_COMPLETED", updatedAt: Date.now(), result: JSON.stringify(result), error: dependency ? outcome.instructions ?? "A user or connected browser must complete this workflow before continuing." : undefined });
} });
export const fail = internalMutation({ args: { taskId: v.id("agentTasks"), error: v.string() }, returns: v.null(), handler: async (ctx, { taskId, error }) => { const row = await ctx.db.get(taskId); if (row?.state === "TASK_STATE_WORKING") await ctx.db.patch(taskId, { state: "TASK_STATE_FAILED", updatedAt: Date.now(), error: error.slice(0, 200) }); } });
export const work = internalAction({ args: { taskId: v.id("agentTasks") }, returns: v.null(), handler: async (ctx, { taskId }) => {
  if (!await ctx.runMutation(internal.platform.agentTasks.begin, { taskId })) return;
  try { await ctx.runMutation(internal.platform.agentTasks.perform, { taskId }); }
  catch (error) { await ctx.runMutation(internal.platform.agentTasks.fail, { taskId, error: safeCapabilityError(error) }); }
} });
export const expire = internalMutation({ args: { taskId: v.id("agentTasks") }, returns: v.null(), handler: async (ctx, { taskId }) => {
  const row = await ctx.db.get(taskId); if (!row || row.expiresAt > Date.now()) return;
  const messages = await ctx.db.query("agentTaskMessages").withIndex("by_task", q => q.eq("taskId", taskId)).collect();
  for (const message of messages) await ctx.db.delete(message._id); await ctx.db.delete(taskId);
} });

/** Recover an interrupted worker; atomic perform/completion makes duplicate delivery harmless. */
export const recover = internalMutation({ args: { taskId: v.id("agentTasks"), attempt: v.number() }, returns: v.null(), handler: async (ctx, { taskId, attempt }) => {
  const row = await ctx.db.get(taskId); if (!row || !["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(row.state)) return;
  if (attempt > 4) { await ctx.db.patch(taskId, { state: "TASK_STATE_FAILED", updatedAt: Date.now(), error: "Worker interrupted; no capability completion committed. Read current application state before retrying." }); return; }
  await ctx.scheduler.runAfter(0, internal.platform.agentTasks.work, { taskId });
  await ctx.scheduler.runAfter(15_000, internal.platform.agentTasks.recover, { taskId, attempt: attempt + 1 });
} });
