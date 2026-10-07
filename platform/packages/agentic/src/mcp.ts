import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CapabilityAdapter } from "./adapter";
import { defaultCatalogue, gatewaySchemas, gatewayDescriptions, searchCapabilities, describeCapabilities, executeCapability, type CapabilityCatalogue } from "./discovery";

import { safeCapabilityError } from "./errors";
export { safeCapabilityError } from "./errors";
export async function handleMcp(request: Request, adapter: CapabilityAdapter, catalogue: CapabilityCatalogue = defaultCatalogue): Promise<Response> {
  const server = new McpServer({ name: "admin-capabilities", version: "0.2.0" }, { capabilities: { tools: {} } });
  for (const name of Object.keys(gatewaySchemas) as (keyof typeof gatewaySchemas)[]) {
    server.registerTool(name, {
      description: gatewayDescriptions[name], inputSchema: gatewaySchemas[name],
      annotations: { readOnlyHint: name !== "capabilities_execute", destructiveHint: name === "capabilities_execute", openWorldHint: false },
    }, async (input: unknown, extra: { signal: AbortSignal }) => {
      try {
        const value = name === "capabilities_search" ? searchCapabilities(catalogue, input)
          : name === "capabilities_describe" ? describeCapabilities(catalogue, input)
          : await executeCapability(adapter, catalogue, input, extra.signal);
        return { content: [{ type: "text" as const, text: JSON.stringify(value ?? null) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: safeCapabilityError(error) }] };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close(); }
}
