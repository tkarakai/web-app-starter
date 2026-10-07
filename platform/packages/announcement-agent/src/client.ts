import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export async function connectMcp(origin: string, token: string) {
  const client = new Client({ name: "pi-announcements", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}
export async function discoverTools(connection: () => Client) {
  const { tools } = await connection().listTools();
  return tools.map(tool => defineTool({
    name: tool.name, label: tool.title ?? tool.name, description: tool.description ?? tool.name,
    parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema), executionMode: "sequential",
    async execute(_callId, input, signal) {
      try {
        const result = await connection().callTool({ name: tool.name, arguments: input }, undefined, { signal });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: {} };
      } catch {
        return { content: [{ type: "text" as const, text: "MCP request failed. Use /auth to renew access, then retry only after checking whether the previous write succeeded." }], details: {} };
      }
    },
  }));
}
