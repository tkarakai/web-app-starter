/** Real-page provider simulator for browsers that do not expose experimental document.modelContext. */
import type { Page } from "@playwright/test";
export async function installWebMcpSimulator(page: Page) {
  await page.addInitScript(() => {
    type Tool = { name: string; execute(input: unknown, context: { signal: AbortSignal }): Promise<unknown> };
    const tools = new Map<string, Tool>();
    Object.defineProperty(document, "modelContext", { configurable: true, value: {
      registerTool(tool: Tool, options?: { signal?: AbortSignal }) {
        if (options?.signal?.aborted) return;
        if (tools.has(tool.name)) throw new Error("Duplicate registration");
        tools.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); }, { once: true });
      },
      async getTools() { return [...tools.values()].map(tool => ({ name: tool.name })); },
      async executeTool(tool: { name: string }, input: unknown) { const entry = tools.get(tool.name); if (!entry) throw new Error("No registered tool"); return entry.execute(input, { signal: new globalThis.AbortController().signal }); },
    } });
  });
}
export async function webMcpTools(page: Page) {
  return page.evaluate(async () => (document as typeof document & { modelContext?: { getTools(): Promise<{ name: string }[]> } }).modelContext?.getTools() ?? []);
}
export async function callWebMcp(page: Page, name: string, input: Record<string, unknown>) {
  return page.evaluate(async ({ name, input }) => {
    const provider = (document as typeof document & { modelContext: { executeTool(tool: { name: string }, input: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> } }).modelContext;
    const result = await provider.executeTool({ name }, input);
    if (result.isError) throw new Error(result.content[0]?.text ?? "Browser tool failed");
    return JSON.parse(result.content[0]!.text) as unknown;
  }, { name, input });
}
