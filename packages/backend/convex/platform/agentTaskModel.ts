import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { currentAgentContract } from "./agentContract";
export const taskTerminalStates = new Set(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);
export interface TaskDto { id: string; contextId: string; status: { state: string; timestamp: string; message?: { messageId: string; role: string; contextId: string; taskId: string; parts: { text: string }[] } }; artifacts?: { artifactId: string; name: string; parts: { text: string; mediaType: string }[] }[]; }
export function taskDto(row: Doc<"agentTasks">, artifacts = true): TaskDto {
  if (!currentAgentContract(row)) throw new Error("TASK_NOT_FOUND");
  return { id: row._id, contextId: row.contextId, status: { state: row.state, timestamp: new Date(row.updatedAt).toISOString(), ...(row.error ? { message: { messageId: `${row._id}-status`, role: "ROLE_AGENT", contextId: row.contextId, taskId: row._id, parts: [{ text: row.error }] } } : {}) },
    ...(artifacts && row.result ? { artifacts: [{ artifactId: `${row._id}-result`, name: "Administration capability result", parts: [{ text: row.result, mediaType: "application/json" }] }] } : {}),
  };
}
export async function ownedTask(ctx: QueryCtx, userId: string, id: string) {
  const key = ctx.db.normalizeId("agentTasks", id); const row = key ? await ctx.db.get(key) : null;
  if (!row || !currentAgentContract(row) || row.userId !== userId || row.expiresAt <= Date.now()) throw new Error("TASK_NOT_FOUND");
  return row;
}
