/** Owned task inspection/cancellation is also an administrative capability in every surface. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { authedQuery, adminMutation } from "./functions";
import { taskDto, ownedTask, taskTerminalStates } from "./agentTaskModel";
import { scheduleAuditEvent } from "./auditTrailHelpers";
export const get = authedQuery({ args: { taskId: v.string() }, handler: async (ctx, { taskId }) => { if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN"); return taskDto(await ownedTask(ctx, ctx.user._id, taskId)); } });
export const list = authedQuery({ args: { paginationOpts: paginationOptsValidator }, handler: async (ctx, { paginationOpts }) => {
  if (ctx.user.role !== "admin") throw new Error("NOT_ADMIN"); if (paginationOpts.numItems > 50) throw new Error("INVALID_PAGE_SIZE");
  const rows = await ctx.db.query("agentTasks").withIndex("by_user", q => q.eq("userId", ctx.user._id)).filter(q => q.gt(q.field("expiresAt"), Date.now())).order("desc").paginate(paginationOpts);
  return { ...rows, page: rows.page.map(row => taskDto(row, false)) };
} });
export const cancel = adminMutation({ args: { taskId: v.string() }, handler: async (ctx, { taskId }) => {
  const row = await ownedTask(ctx, ctx.user._id, taskId); if (taskTerminalStates.has(row.state)) throw new Error("TASK_NOT_CANCELABLE");
  await ctx.db.patch(row._id, { state: "TASK_STATE_CANCELED", updatedAt: Date.now(), error: "Canceled before execution committed." });
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: "agent-tasks", action: "admin.agent_task_canceled", resource: `agent-task:${taskId}`, status: "succeeded" });
  return taskDto((await ctx.db.get(row._id))!);
} });
