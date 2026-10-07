/** Independent A2A 1.0 JSON-RPC client; pi supplies planning, the server executes structured tasks. */
import { gatewayToolDefinitions } from "@web-app-starter/agentic/discovery";
import { A2A_VERSION } from "@web-app-starter/agentic/a2a";
import type { AdminToolConnection } from "./client";
export interface A2aTask { id: string; status: { state: string; message?: { parts?: { text?: string }[] } }; artifacts?: { parts: { data?: unknown }[] }[]; }
export class A2aClient implements AdminToolConnection {
  constructor(private readonly origin: string, private readonly token: string) {}
  async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(this.origin + "/api/a2a", { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", "A2A-Version": A2A_VERSION }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }), signal: signal ?? AbortSignal.timeout(30_000) });
    const value = await response.json() as { result?: unknown; error?: { code?: number; message?: string } };
    if (!response.ok || value.error) throw new Error(value.error?.message ?? `A2A HTTP ${response.status}`);
    return value.result;
  }
  async listTools() { return { tools: gatewayToolDefinitions() }; }
  async callTool({ name, arguments: input }: { name: string; arguments?: Record<string, unknown> }, _unused?: undefined, options?: { signal?: AbortSignal }) {
    const operation = { capabilities_search: "search", capabilities_describe: "describe", capabilities_execute: "execute" }[name];
    if (!operation) throw new Error("Unknown gateway operation");
    const value = await this.rpc("SendMessage", { message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ data: { operation, input: input ?? {} }, mediaType: "application/json" }] }, configuration: { returnImmediately: true, historyLength: 0 } }, options?.signal) as { task: A2aTask };
    let task = value.task; const deadline = Date.now() + 30_000;
    while (["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(task.status.state)) {
      if (options?.signal?.aborted || Date.now() > deadline) throw new Error(`A2A task ${task.id} is still running. GetTask before retrying a write.`);
      await new Promise(resolve => setTimeout(resolve, 150));
      task = await this.rpc("GetTask", { id: task.id, historyLength: 0 }, options?.signal) as A2aTask;
    }
    const result = task.status.state === "TASK_STATE_COMPLETED" ? task.artifacts?.[0]?.parts[0]?.data : task.status.message?.parts?.[0]?.text ?? task.status.state;
    return { taskId: task.id, ...(task.status.state !== "TASK_STATE_COMPLETED" ? { isError: true } : {}), content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  async close() {}
}
export async function connectA2a(origin: string, token: string) {
  const response = await fetch(origin + "/.well-known/agent-card.json", { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("A2A card unavailable");
  const card = await response.json() as { supportedInterfaces?: { url?: string; protocolBinding?: string; protocolVersion?: string }[] };
  if (!card.supportedInterfaces?.some(item => item.url === origin + "/api/a2a" && item.protocolBinding === "JSONRPC" && item.protocolVersion === A2A_VERSION)) throw new Error("Unsupported A2A card");
  return new A2aClient(origin, token);
}
