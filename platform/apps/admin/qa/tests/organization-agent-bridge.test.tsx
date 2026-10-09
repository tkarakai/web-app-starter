/* global DOMRectList */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { WebMcpSimulator, type BrowserTool } from "@web-app-starter/agentic/webmcp";

const mocks = vi.hoisted(() => ({
  actor: "operator-a" as string | null,
  configuration: { surfaces: { webmcp: { enabled: true, generation: "generation-a" } } },
  client: { query: vi.fn(), mutation: vi.fn() }, router: { push: vi.fn() },
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client, useQuery: () => mocks.configuration }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/auth/auth-guard", () => ({ useAuthUser: () => mocks.actor ? { id: mocks.actor } : null }));
vi.mock("@repo/backend", () => ({ api: { platform: { agentSurfaces: { configuration: "configuration" }, agentCapabilities: { browserGateway: "gateway", browserRead: "read", browserWrite: "write" } } } }));

import { AgentBrowserBridge } from "../../src/components/agent-browser-bridge";

let provider: WebMcpSimulator;
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor = "operator-a";
  mocks.configuration = { surfaces: { webmcp: { enabled: true, generation: "generation-a" } } };
  provider = new WebMcpSimulator();
  Object.defineProperty(document, "modelContext", { configurable: true, value: provider });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "checkVisibility").mockReturnValue(true);
  mocks.client.query.mockImplementation(async (_reference, { input }) => JSON.stringify({ ...input, effect: "browser", resultOffset: 0 }));
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function registered() {
  await waitFor(() => expect(provider.tools.size).toBe(3));
  return provider.tools.get("capabilities_execute")!;
}
async function call(tool: BrowserTool, name: string, input: Record<string, unknown> = {}) {
  const result = await tool.execute({ name, input }) as { isError?: boolean; content: { text: string }[] };
  return { ...result, value: result.isError ? null : JSON.parse(result.content[0].text) };
}

test.each(["actor", "generation"])("%s change invalidates held tool and prepared DOM command", async boundary => {
  const view = render(<AgentBrowserBridge />); const held = await registered();
  let resolve!: (value: string) => void;
  mocks.client.query.mockReturnValueOnce(new Promise<string>(done => { resolve = done; }));
  const pending = call(held, "browser_navigate", { path: "/manage/organizations" });
  if (boundary === "actor") mocks.actor = "operator-b";
  else mocks.configuration = { surfaces: { webmcp: { enabled: true, generation: "generation-b" } } };
  view.rerender(<AgentBrowserBridge />);
  await act(async () => resolve(JSON.stringify({ name: "browser_navigate", input: { path: "/manage/organizations" }, effect: "browser", resultOffset: 0 })));
  expect((await pending).isError).toBe(true);
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect((await call(held, "browser_readPage", { offset: 0, controlsOffset: 0 })).isError).toBe(true);
});

test("sign-out aborts a held browser command even while configuration is cached", async () => {
  const view = render(<AgentBrowserBridge />); const held = await registered();
  mocks.actor = null; view.rerender(<AgentBrowserBridge />);
  expect((await call(held, "browser_navigate", { path: "/manage/organizations" })).isError).toBe(true);
  expect(mocks.router.push).not.toHaveBeenCalled();
});

test("native result arriving after actor withdrawal is not disclosed by a held tool", async () => {
  const view = render(<AgentBrowserBridge />); const held = await registered();
  let resolve!: (value: unknown) => void;
  mocks.client.query.mockResolvedValueOnce(JSON.stringify({ name: "organizations_get", input: { organizationId: "org-a" }, effect: "read", resultOffset: 0 }))
    .mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const pending = call(held, "organizations_get", { organizationId: "org-a" });
  await waitFor(() => expect(mocks.client.query).toHaveBeenCalledTimes(2));
  mocks.actor = null; view.rerender(<AgentBrowserBridge />);
  await act(async () => resolve({ contacts: [{ email: "WITHDRAWN_CONTACT" }] }));
  const response = await pending;
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain("WITHDRAWN_CONTACT");
});

test("opaque controls from before disable/re-enable cannot alias new controls", async () => {
  const view = render(<><AgentBrowserBridge /><button>Organization A</button></>);
  const held = await registered();
  const before = await call(held, "browser_readPage", { offset: 0, controlsOffset: 0 });
  const staleId = before.value.result.controls[0].controlId;
  mocks.configuration = { surfaces: { webmcp: { enabled: false, generation: "generation-off" } } };
  view.rerender(<AgentBrowserBridge />);
  await waitFor(() => expect(provider.tools.size).toBe(0));
  mocks.configuration = { surfaces: { webmcp: { enabled: true, generation: "generation-b" } } };
  const clicked = vi.fn(); view.rerender(<><AgentBrowserBridge /><button onClick={clicked}>Organization B</button></>);
  const fresh = await registered();
  await call(fresh, "browser_readPage", { offset: 0, controlsOffset: 0 });
  expect((await call(fresh, "browser_activate", { controlId: staleId })).isError).toBe(true);
  expect(clicked).not.toHaveBeenCalled();
});
