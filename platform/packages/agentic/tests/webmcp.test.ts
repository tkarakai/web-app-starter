import { expect, test } from "bun:test";
import { registerWebMcp, WebMcpSimulator } from "../src/webmcp";
import { defaultCatalogue } from "../src/discovery";
import { withBrowserCapabilities } from "../src/browser-catalogue";

test("WebMCP simulator enforces authentication, schemas, cancellation and unregister", async () => {
  const provider = new WebMcpSimulator(); const controller = new globalThis.AbortController();
  let authenticated = false; let executions = 0;
  await registerWebMcp(provider, withBrowserCapabilities(defaultCatalogue), { async execute() { executions++; return { id: "native-id" }; } }, async () => { if (!authenticated) throw new Error("NOT_ADMIN"); }, controller.signal);
  expect(provider.tools.size).toBe(3);
  expect(await provider.execute("capabilities_search", { query: "announcements" })).toMatchObject({ isError: true });
  expect(executions).toBe(0); authenticated = true;
  const discovery = await provider.execute("capabilities_search", { query: "browser" });
  expect(JSON.stringify(discovery)).toContain("browser_readPage");
  const invalid = await provider.execute("capabilities_execute", { name: "announcements_create", input: { name: "X", bearer: "INJECTED" } });
  expect(invalid).toMatchObject({ isError: true }); expect(executions).toBe(0);
  expect(await provider.execute("capabilities_execute", { name: "announcements_create", input: { name: "X", bannerText: "Y" } })).not.toHaveProperty("isError");
  expect(executions).toBe(1);
  const staleTool = provider.tools.get("capabilities_execute")!; controller.abort();
  expect(provider.tools.size).toBe(0);
  expect(await staleTool.execute({ name: "announcements_delete", input: { announcementId: "x" } })).toMatchObject({ isError: true });
  expect(executions).toBe(1);
});
