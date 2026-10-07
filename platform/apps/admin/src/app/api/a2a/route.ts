import { api } from "@repo/backend";
import { A2A_VERSION, a2aError, messageRequest } from "@web-app-starter/agentic/a2a";
import { safeCapabilityError } from "@web-app-starter/agentic/errors";
import { remoteRequest, limitedBody } from "@/lib/agentic/remote-request";
import { privateJson } from "@/lib/agentic/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await remoteRequest(request, "a2a"); if (auth.response) return auth.response;
  let rpc;
  try { rpc = JSON.parse(new globalThis.TextDecoder().decode(await limitedBody(request))) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }; }
  catch { return privateJson(a2aError(null, -32700, "Invalid JSON payload"), 400); }
  const id = rpc?.id;
  if (!rpc || rpc.jsonrpc !== "2.0" || (typeof id !== "string" && typeof id !== "number") || typeof rpc.method !== "string") return privateJson(a2aError(id, -32600, "Invalid request"), 400);
  if (request.headers.get("A2A-Version") !== A2A_VERSION) return privateJson(a2aError(id, -32009, "VersionNotSupportedError: use A2A-Version: 1.0"), 400);
  const params = rpc.params && typeof rpc.params === "object" && !Array.isArray(rpc.params) ? rpc.params as Record<string, unknown> : {};
  const credentials = { token: auth.token!, resource: auth.resource! }; const client = auth.client!;
  try {
    let result;
    if (rpc.method === "SendMessage") {
      const parsed = messageRequest.parse(params);
      let task = await client.mutation(api.platform.agentTasks.send, { ...credentials, params: parsed }) as { id: string; status: { state: string } };
      if (!parsed.configuration?.returnImmediately) {
        const deadline = Date.now() + 25_000;
        while (["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(task.status.state)) {
          if (request.signal.aborted || Date.now() > deadline) return privateJson({ ...a2aError(id, -32603, "Task is still running; retrieve it with GetTask before retrying"), taskId: task.id }, 504);
          await new Promise(resolve => setTimeout(resolve, 100));
          task = await client.query(api.platform.agentTasks.get, { ...credentials, id: task.id }) as typeof task;
        }
      }
      result = { task };
    } else if (rpc.method === "GetTask" || rpc.method === "CancelTask") {
      if (typeof params.id !== "string" || params.id.length > 150) throw new Error("INVALID_PARAMS");
      result = rpc.method === "GetTask" ? await client.query(api.platform.agentTasks.get, { ...credentials, id: params.id }) : await client.mutation(api.platform.agentTasks.cancel, { ...credentials, id: params.id });
    } else if (rpc.method === "ListTasks") {
      if (params.contextId !== undefined && typeof params.contextId !== "string" || params.status !== undefined && typeof params.status !== "string" || params.pageSize !== undefined && typeof params.pageSize !== "number" || params.pageToken !== undefined && typeof params.pageToken !== "string" || params.includeArtifacts !== undefined && typeof params.includeArtifacts !== "boolean" || params.statusTimestampAfter !== undefined && typeof params.statusTimestampAfter !== "string") throw new Error("INVALID_PARAMS");
      result = await client.query(api.platform.agentTasks.list, { ...credentials, contextId: params.contextId as string | undefined, status: params.status as string | undefined, pageSize: params.pageSize as number | undefined, pageToken: params.pageToken as string | undefined, includeArtifacts: params.includeArtifacts as boolean | undefined, statusTimestampAfter: params.statusTimestampAfter as string | undefined });
    } else if (rpc.method.includes("PushNotification")) return privateJson(a2aError(id, -32003, "PushNotificationNotSupportedError"), 400);
    else if (["SendStreamingMessage", "SubscribeToTask", "GetExtendedAgentCard"].includes(rpc.method)) return privateJson(a2aError(id, -32004, "UnsupportedOperationError"), 400);
    else return privateJson(a2aError(id, -32601, "Method not found"), 400);
    return privateJson({ jsonrpc: "2.0", id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = message.includes("TASK_NOT_FOUND") ? -32001 : message.includes("TASK_NOT_CANCELABLE") ? -32002 : message.includes("PUSH_NOT_SUPPORTED") ? -32003 : message.includes("CONTENT_TYPE_NOT_SUPPORTED") ? -32005 : -32602;
    const text = code === -32001 ? "TaskNotFoundError" : code === -32002 ? "TaskNotCancelableError" : code === -32003 ? "PushNotificationNotSupportedError" : code === -32005 ? "ContentTypeNotSupportedError" : safeCapabilityError(error);
    return privateJson(a2aError(id, code, text), 400);
  }
}
