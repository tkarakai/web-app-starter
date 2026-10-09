import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebMcpSimulator } from "@web-app-starter/agentic/webmcp";
import { AgentBrowserBridge } from "../../src/components/agent-browser-bridge";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), bfcacheId: "first" },
  client: { query: vi.fn(), mutation: vi.fn() },
  enabled: true as boolean | undefined,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("convex/react", () => ({
  useConvex: () => mocks.client,
  useQuery: () => mocks.enabled === undefined ? undefined : { surfaces: { webmcp: { enabled: mocks.enabled } } },
}));

let provider: WebMcpSimulator;
beforeEach(() => {
  mocks.router = { push: vi.fn(), bfcacheId: "first" };
  mocks.client = { query: vi.fn(), mutation: vi.fn() };
  mocks.enabled = true;
  provider = new WebMcpSimulator();
  Object.defineProperty(document, "modelContext", { configurable: true, value: provider });
});
afterEach(() => { Reflect.deleteProperty(document, "modelContext"); });

async function registered() {
  await waitFor(() => expect(provider.tools.size).toBe(3));
}
function pendingGateway() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(done => { resolve = done; });
  mocks.client.query.mockReturnValueOnce(promise);
  return resolve;
}
const navigation = { name: "browser_navigate", input: { path: "/manage/announcements" }, effect: "browser", resultOffset: 0 };

it("keeps in-flight tools registered across router identity changes and uses the current router", async () => {
  const view = render(<AgentBrowserBridge />);
  await registered();
  const tool = provider.tools.get("capabilities_execute")!;
  const finish = pendingGateway();
  const result = tool.execute({ name: navigation.name, input: navigation.input });
  const previousPush = mocks.router.push;
  mocks.router = { push: vi.fn(), bfcacheId: "next" };
  view.rerender(<AgentBrowserBridge />);
  await act(async () => finish(JSON.stringify(navigation)));

  expect(await result).not.toHaveProperty("isError");
  expect(provider.tools.get("capabilities_execute")).toBe(tool);
  expect(previousPush).not.toHaveBeenCalled();
  expect(mocks.router.push).toHaveBeenCalledWith("/manage/announcements");
});

it.each(["disabled", "loading", "unmounted", "client-replaced", "request-aborted"] as const)(
  "blocks a pending browser action when %s and removes revoked registrations",
  async reason => {
    const view = render(<AgentBrowserBridge />);
    await registered();
    const tool = provider.tools.get("capabilities_execute")!;
    const finish = pendingGateway();
    const controller = new globalThis.AbortController();
    const result = tool.execute({ name: navigation.name, input: navigation.input }, { signal: controller.signal });
    if (reason === "unmounted") view.unmount();
    else if (reason === "request-aborted") controller.abort();
    else {
      if (reason === "client-replaced") mocks.client = { query: vi.fn(), mutation: vi.fn() };
      else mocks.enabled = reason === "loading" ? undefined : false;
      view.rerender(<AgentBrowserBridge />);
    }
    await act(async () => finish(JSON.stringify(navigation)));
    expect(await result).toMatchObject({ isError: true, content: [{ text: "SURFACE_DISABLED" }] });
    expect(mocks.router.push).not.toHaveBeenCalled();
    if (reason === "request-aborted") expect(provider.tools.get("capabilities_execute")).toBe(tool);
    else if (reason === "client-replaced") {
      await registered();
      expect(provider.tools.get("capabilities_execute")).not.toBe(tool);
    } else expect(provider.tools.size).toBe(0);
  },
);

it("checks the gateway for each call and propagates backend policy rejection without navigation", async () => {
  render(<AgentBrowserBridge />);
  await registered();
  mocks.client.query.mockResolvedValueOnce(JSON.stringify(navigation)).mockRejectedValueOnce(new Error("SURFACE_DISABLED"));
  const tool = provider.tools.get("capabilities_execute")!;
  expect(await tool.execute({ name: navigation.name, input: navigation.input })).not.toHaveProperty("isError");
  expect(await tool.execute({ name: navigation.name, input: navigation.input })).toMatchObject({ isError: true });
  expect(mocks.client.query).toHaveBeenCalledTimes(2);
  expect(mocks.router.push).toHaveBeenCalledTimes(1);
});

it("revokes pending writes on disablement and cannot revive old tools by re-enabling", async () => {
  const view = render(<AgentBrowserBridge />);
  await registered();
  const tool = provider.tools.get("capabilities_execute")!;
  const finish = pendingGateway();
  const input = { name: "announcements_delete", input: { announcementId: "fixture" } };
  const result = tool.execute(input);
  mocks.enabled = false;
  view.rerender(<AgentBrowserBridge />);
  expect(provider.tools.size).toBe(0);
  mocks.enabled = true;
  view.rerender(<AgentBrowserBridge />);
  await registered();
  await act(async () => finish(JSON.stringify({ ...input, effect: "write", resultOffset: 0 })));

  expect(await result).toMatchObject({ isError: true, content: [{ text: "SURFACE_DISABLED" }] });
  expect(await tool.execute(input)).toMatchObject({ isError: true, content: [{ text: "SURFACE_DISABLED" }] });
  expect(mocks.client.mutation).not.toHaveBeenCalled();
  expect(mocks.client.query).toHaveBeenCalledTimes(1);
  expect(provider.tools.get("capabilities_execute")).not.toBe(tool);
});

it.each([false, undefined])("does not register tools before policy enables them (%s)", enabled => {
  mocks.enabled = enabled;
  render(<AgentBrowserBridge />);
  expect(provider.tools.size).toBe(0);
});

it("tolerates an unsupported browser", () => {
  Reflect.deleteProperty(document, "modelContext");
  render(<AgentBrowserBridge />);
  expect(mocks.client.query).not.toHaveBeenCalled();
});
