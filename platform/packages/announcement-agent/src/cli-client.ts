import { gatewayToolDefinitions } from "@web-app-starter/agentic/discovery";
import type { AdminToolConnection } from "./client";
export function connectCli(origin: string, token: string): AdminToolConnection {
  return {
    async listTools() { return { tools: gatewayToolDefinitions() }; },
    async callTool({ name, arguments: input }, _unused, options) {
      const operation = { capabilities_search: "search", capabilities_describe: "describe", capabilities_execute: "execute" }[name];
      if (!operation) throw new Error("Unknown gateway operation");
      const response = await fetch(origin + "/api/agent/cli", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation, input }), signal: options?.signal ?? AbortSignal.timeout(30_000) });
      const value = await response.json() as { result?: unknown; error?: string };
      return { ...(response.ok ? {} : { isError: true }), content: [{ type: "text", text: JSON.stringify(response.ok ? value.result : value.error ?? `HTTP ${response.status}`) }] };
    },
    async close() {},
  };
}
