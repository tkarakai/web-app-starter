import { gatewayContracts } from "./gateway-contract";
import { safeCapabilityError } from "./errors";
export interface BrowserTool {
  name: string; description?: string; inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; consequentialHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown, context?: { signal?: AbortSignal }): Promise<unknown>;
}
export interface ModelContextProvider { registerTool(tool: BrowserTool, options?: { signal?: AbortSignal }): void | Promise<void>; }
export type GatewayInvoker = (name: string, input: unknown, signal?: AbortSignal) => Promise<unknown>;
/** The browser loads JSON contracts only; native discovery/validation stays on the server. */
export async function registerWebMcp(provider: ModelContextProvider, invoke: GatewayInvoker, signal: AbortSignal) {
  for (const tool of gatewayContracts) {
    if (signal.aborted) return;
    await provider.registerTool({ ...tool, annotations: { readOnlyHint: tool.name !== "capabilities_execute", consequentialHint: tool.name === "capabilities_execute", untrustedContentHint: true },
      async execute(input, context) {
        try {
          if (signal.aborted || context?.signal?.aborted) throw new Error("SURFACE_DISABLED");
          const value = await invoke(tool.name, input, context?.signal);
          return { content: [{ type: "text", text: JSON.stringify(value) }] };
        } catch (error) { return { isError: true, content: [{ type: "text", text: safeCapabilityError(error) }] }; }
      },
    }, { signal });
  }
}
export class WebMcpSimulator implements ModelContextProvider {
  readonly tools = new Map<string, BrowserTool>();
  registerTool(tool: BrowserTool, options?: { signal?: AbortSignal }) {
    if (this.tools.has(tool.name)) throw new Error("DUPLICATE_TOOL"); if (options?.signal?.aborted) return;
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener("abort", () => { if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name); }, { once: true });
  }
  async execute(name: string, input: unknown) { const tool = this.tools.get(name); if (!tool) throw new Error("UNKNOWN_TOOL"); return tool.execute(input, {}); }
}
