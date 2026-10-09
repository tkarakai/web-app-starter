/** @deprecated API namespace retained for compatibility; these are app-operator operations. */
/** Owned task inspection/cancellation is also an administrative capability in every surface. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { authedQuery, appOperatorMutation } from "./functions";
import { taskDto, ownedTask, taskTerminalStates } from "./agentTaskModel";
import { scheduleAuditEvent } from "./auditTrailHelpers";
import { requireAppOperator } from "./appOperatorAccess";
import { LEGACY_APP_OPERATOR_TASK_ADMIN_AUDIT_SOURCE_DETAIL } from "./appOperatorAuditCompatibility";
import { AGENT_CONTRACT_EPOCH } from "./agentContract";
export const get = authedQuery({ args: { taskId: v.string() }, handler: async (ctx, { taskId }) => { await requireAppOperator(ctx); return taskDto(await ownedTask(ctx, ctx.user._id, taskId)); } });
export const list = authedQuery({ args: { paginationOpts: paginationOptsValidator }, handler: async (ctx, { paginationOpts }) => {
  await requireAppOperator(ctx); if (paginationOpts.numItems > 50) throw new Error("INVALID_PAGE_SIZE");
  const rows = await ctx.db.query("agentTasks").withIndex("by_user", q => q.eq("userId", ctx.user._id)).filter(q => q.and(q.eq(q.field("contractEpoch"), AGENT_CONTRACT_EPOCH), q.gt(q.field("expiresAt"), Date.now()))).order("desc").paginate(paginationOpts);
  return { ...rows, page: rows.page.map(row => taskDto(row, false)) };
} });
export const cancel = appOperatorMutation({ args: { taskId: v.string() }, handler: async (ctx, { taskId }) => {
  await requireAppOperator(ctx, { write: true });
  const row = await ownedTask(ctx, ctx.user._id, taskId); if (taskTerminalStates.has(row.state)) throw new Error("TASK_NOT_CANCELABLE");
  await ctx.db.patch(row._id, { state: "TASK_STATE_CANCELED", updatedAt: Date.now(), error: "Canceled before execution committed." });
  await scheduleAuditEvent(ctx, { actor: ctx.user.email, authenticatedUserId: ctx.ownerId, sourceDetail: LEGACY_APP_OPERATOR_TASK_ADMIN_AUDIT_SOURCE_DETAIL, action: "admin.agent_task_canceled", resource: `agent-task:${taskId}`, status: "succeeded" });
  return taskDto((await ctx.db.get(row._id))!);
} });
