import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { announcementCatalogue, type CapabilityName } from "./catalogue";
import type { CapabilityAdapter } from "./adapter";

export async function handleMcp(request: Request, adapter: CapabilityAdapter): Promise<Response> {
  const server = new McpServer({ name: "admin-announcements", version: "0.1.0" }, { capabilities: { tools: {} } });
  for (const name of Object.keys(announcementCatalogue) as CapabilityName[]) {
    const capability = announcementCatalogue[name];
    server.registerTool(name, {
      title: capability.title, description: capability.description, inputSchema: capability.schema,
      annotations: { readOnlyHint: capability.effect === "read", destructiveHint: name === "announcements_delete" || name === "announcements_update", idempotentHint: capability.effect === "read", openWorldHint: false },
    }, async (input: unknown, extra: { signal: AbortSignal }) => {
      try {
        const value = await adapter.execute(name, capability.schema.parse(input), extra.signal);
        return { content: [{ type: "text" as const, text: JSON.stringify(value ?? null) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : "CAPABILITY_FAILED";
        // Never include backend trace/context or authentication credentials in model-visible errors.
        const code = ["RECENT_AUTHENTICATION_REQUIRED", "INVALID_AGENT_TOKEN", "ANNOUNCEMENT_NOT_FOUND", "NAME_REQUIRED", "BANNER_TEXT_REQUIRED", "INVALID_SCHEDULE"].find(code => message.includes(code));
        return { isError: true, content: [{ type: "text" as const, text: code ?? "CAPABILITY_FAILED: check inputs or reauthenticate" }] };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close(); }
}
