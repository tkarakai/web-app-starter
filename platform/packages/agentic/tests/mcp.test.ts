import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcp } from "../src/mcp";
import { validateAuthorization } from "../src/oauth";

describe("MCP catalogue adapter", () => {
  test("independent SDK client discovers five tools and executes through the common adapter", async () => {
    const calls: unknown[] = [];
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      fetch: async (url, init) => handleMcp(new Request(url, init), { async execute(name, input) { calls.push({ name, input }); return { id: "native-id" }; } }),
    });
    const client = new Client({ name: "independent-test", version: "1" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(5);
      expect(tools.tools.find(t => t.name === "announcements_create")?.inputSchema.required).toEqual(["name", "bannerText"]);
      const result = await client.callTool({ name: "announcements_create", arguments: { name: "Draft", bannerText: "Hello" } });
      expect(result.isError).not.toBe(true);
      expect(calls).toEqual([{ name: "announcements_create", input: { name: "Draft", bannerText: "Hello" } }]);
      const invalid = await client.callTool({ name: "announcements_create", arguments: { name: "Draft", token: "injected" } });
      expect(invalid.isError).toBe(true);
      expect(calls).toHaveLength(1);
    } finally { await client.close(); }
  });
  test("backend exceptions cannot leak secrets into tool responses", async () => {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      fetch: async (url, init) => handleMcp(new Request(url, init), { async execute() { throw new Error("sensitive credential trace"); } }),
    }));
    try {
      const result = await client.callTool({ name: "announcements_list", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("sensitive");
    } finally { await client.close(); }
  });
  test("authorization requests reject non-loopback redirects and weak or missing PKCE/state", () => {
    const base = new URLSearchParams({ client_id: "pi-announcements", response_type: "code", redirect_uri: "http://127.0.0.1:45678/callback", scope: "announcements:manage", code_challenge_method: "S256", code_challenge: "c".repeat(43), state: "s".repeat(43) });
    expect(validateAuthorization(base).clientId).toBe("pi-announcements");
    for (const [key, value] of [["redirect_uri", "https://attacker.test/callback"], ["code_challenge_method", "plain"], ["state", ""], ["scope", "all"]]) {
      const bad = new URLSearchParams(base); bad.set(key, value);
      expect(() => validateAuthorization(bad)).toThrow();
    }
  });
});
