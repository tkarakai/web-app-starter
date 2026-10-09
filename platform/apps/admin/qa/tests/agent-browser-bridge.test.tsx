import { act, render, waitFor } from "@testing-library/react";
import { Activity, createContext, useCallback, useContext } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebMcpSimulator } from "@web-app-starter/agentic/webmcp";
import { AgentBrowserBridge } from "../../src/components/agent-browser-bridge";

const Authentication = createContext<boolean | undefined>(undefined);

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), bfcacheId: "first" },
  client: { query: vi.fn(), mutation: vi.fn() },
  enabled: true as boolean | undefined,
  session: { isPending: false, data: { session: { id: "session-first" } } as { session: { id: string } } | null },
  authenticated: true,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: { useSession: () => mocks.session } }));
vi.mock("convex/react", () => ({
  useConvex: () => mocks.client,
  useConvexAuth: () => ({ isAuthenticated: useContext(Authentication) ?? mocks.authenticated }),
  useQuery: () => mocks.enabled === undefined ? undefined : { surfaces: { webmcp: { enabled: mocks.enabled } } },
}));

let provider: WebMcpSimulator;
beforeEach(() => {
  mocks.router = { push: vi.fn(), bfcacheId: "first" };
  mocks.client = { query: vi.fn(), mutation: vi.fn() };
  mocks.enabled = true;
  mocks.session = { isPending: false, data: { session: { id: "session-first" } } };
  mocks.authenticated = true;
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

it("does not advertise the server-token registration before client session hydration and Convex authentication settle", async () => {
  // A server token can populate the policy query before Better Auth finishes
  // hydrating its session. Resolving that session restarts Convex authentication.
  mocks.session = { isPending: true, data: null };
  const view = render(<AgentBrowserBridge />);
  await act(async () => {});
  expect(provider.tools.size).toBe(0);
  mocks.session = { isPending: false, data: { session: { id: "session-first" } } };
  mocks.authenticated = false;
  view.rerender(<AgentBrowserBridge />);
  await act(async () => {});
  expect(provider.tools.size).toBe(0);
  mocks.authenticated = true;
  view.rerender(<AgentBrowserBridge />);
  await registered();
});

it("does not publish tools from the render that hydrates the session before Convex resets its old auth state", async () => {
  const { ConvexProviderWithAuth, useConvexAuth } = await vi.importActual<typeof import("convex/react")>("convex/react");
  // Use the installed provider's real cleanup/acknowledgment ordering. Better
  // Auth starts with a server token and changes its token fetcher on session ID.
  function useAuth() {
    const id = mocks.session.data?.session.id;
    const fetchAccessToken = useCallback(async () => id ?? "server-token", [id]);
    return { isLoading: false, isAuthenticated: true, fetchAccessToken };
  }
  let acknowledge!: () => void;
  const client = {
    setAuth: vi.fn((_fetch: unknown, onChange?: (authenticated: boolean) => void) => { acknowledge = () => onChange?.(true); }),
    clearAuth: vi.fn(),
  };
  function Consumer() {
    const { isAuthenticated } = useConvexAuth();
    return <Authentication.Provider value={isAuthenticated}><AgentBrowserBridge /></Authentication.Provider>;
  }
  function Provider() {
    return <ConvexProviderWithAuth client={client} useAuth={useAuth}><Consumer /></ConvexProviderWithAuth>;
  }
  const register = vi.spyOn(provider, "registerTool");
  mocks.session = { isPending: true, data: null };
  const view = render(<Provider />);
  await act(async () => acknowledge());
  mocks.session = { isPending: false, data: { session: { id: "session-first" } } };
  view.rerender(<Provider />);
  await act(async () => {});
  expect(register).not.toHaveBeenCalled();
  await act(async () => acknowledge());
  await registered();
});

it.each(["session-pending", "session-missing", "session-replaced", "convex-unauthenticated"] as const)(
  "revokes pending tools when %s even if the previous policy result is still enabled",
  async reason => {
    const view = render(<AgentBrowserBridge />);
    await registered();
    const tool = provider.tools.get("capabilities_execute")!;
    const finish = pendingGateway();
    const result = tool.execute({ name: navigation.name, input: navigation.input });
    if (reason === "session-pending") mocks.session = { ...mocks.session, isPending: true };
    else if (reason === "session-missing") mocks.session = { isPending: false, data: null };
    else if (reason === "session-replaced") mocks.session = { isPending: false, data: { session: { id: "session-next" } } };
    else mocks.authenticated = false;
    view.rerender(<AgentBrowserBridge />);
    await act(async () => finish(JSON.stringify(navigation)));
    expect(await result).toMatchObject({ isError: true, content: [{ text: "SURFACE_DISABLED" }] });
    expect(mocks.router.push).not.toHaveBeenCalled();
    if (reason === "session-replaced") {
      await registered();
      expect(provider.tools.get("capabilities_execute")).not.toBe(tool);
    } else expect(provider.tools.size).toBe(0);
  },
);

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

it("keeps registration when the session payload refreshes with the same identity", async () => {
  const view = render(<AgentBrowserBridge />);
  await registered();
  const tool = provider.tools.get("capabilities_execute")!;
  const finish = pendingGateway();
  const result = tool.execute({ name: navigation.name, input: navigation.input });
  mocks.session = { isPending: false, data: { session: { id: "session-first" } } };
  view.rerender(<AgentBrowserBridge />);
  await act(async () => finish(JSON.stringify(navigation)));
  expect(await result).not.toHaveProperty("isError");
  expect(provider.tools.get("capabilities_execute")).toBe(tool);
});

it("revokes in-flight tools when the auth gate hides its Activity and never revives the old registration", async () => {
  const view = render(<Activity mode="visible"><AgentBrowserBridge /></Activity>);
  await registered();
  const tool = provider.tools.get("capabilities_execute")!;
  const finish = pendingGateway();
  const result = tool.execute({ name: navigation.name, input: navigation.input });
  view.rerender(<Activity mode="hidden"><AgentBrowserBridge /></Activity>);
  expect(provider.tools.size).toBe(0);
  view.rerender(<Activity mode="visible"><AgentBrowserBridge /></Activity>);
  await registered();
  await act(async () => finish(JSON.stringify(navigation)));
  expect(await result).toMatchObject({ isError: true, content: [{ text: "SURFACE_DISABLED" }] });
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect(provider.tools.get("capabilities_execute")).not.toBe(tool);
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
