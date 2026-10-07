import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcp } from "../src/mcp";
import { validateAuthorization } from "../src/oauth";
import { searchCapabilities, describeCapabilities, executeCapability, boundedResult, defaultCatalogue } from "../src/discovery";

async function connection(catalogue = defaultCatalogue, execute = async (_name: string, _input: Record<string, unknown>): Promise<unknown> => ({ id: "native-id" })) {
  const client = new Client({ name: "independent-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
    fetch: async (url, init) => handleMcp(new Request(url, init), { execute }, catalogue),
  }));
  return client;
}
describe("bounded MCP discovery", () => {
  test("independent SDK client discovers schemas on demand and validates execution", async () => {
    const calls: unknown[] = [];
    const client = await connection(defaultCatalogue, async (name, input) => { calls.push({ name, input }); return { id: "native-id" }; });
    try {
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(["capabilities_search", "capabilities_describe", "capabilities_execute"]);
      const described = await client.callTool({ name: "capabilities_describe", arguments: { names: ["announcements_create"] } });
      expect(JSON.stringify(described)).toContain("bannerText");
      const result = await client.callTool({ name: "capabilities_execute", arguments: { name: "announcements_create", input: { name: "Draft", bannerText: "Hello" } } });
      expect(result.isError).not.toBe(true);
      expect(calls).toEqual([{ name: "announcements_create", input: { name: "Draft", bannerText: "Hello" } }]);
      const invalid = await client.callTool({ name: "capabilities_execute", arguments: { name: "announcements_create", input: { name: "Draft", token: "injected" } } });
      expect(invalid.isError).toBe(true); expect(calls).toHaveLength(1);
    } finally { await client.close(); }
  });
  test("1,000 capabilities do not grow bootstrap context; discovery and results are bounded", async () => {
    const large = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`test_${i}`, { title: `Test ${i}`, description: "Example capability", effect: "read" as const, schema: z.object({ text: z.string() }).strict() }]));
    const smallClient = await connection(); const bigClient = await connection(large);
    try {
      const small = JSON.stringify(await smallClient.listTools()); const big = JSON.stringify(await bigClient.listTools());
      expect(big).toBe(small); expect(big.length).toBeLessThan(5000);
      expect(searchCapabilities(large, {}).matches).toHaveLength(8);
      expect(searchCapabilities(large, { limit: 15, offset: 990 }).nextOffset).toBeNull();
      expect(() => describeCapabilities(large, { names: ["test_1", "test_2", "test_3", "test_4"] })).toThrow();
      const value = "x".repeat(25_000); const first = boundedResult(value); const second = boundedResult(value, first.nextOffset ?? 0);
      expect(first.chunk?.length).toBe(12_000); expect(second.nextOffset).toBe(24_000);
      let calls = 0;
      await expect(executeCapability({ async execute() { calls++; } }, defaultCatalogue, { name: "announcements_create", input: { name: "x", bannerText: "x" }, resultOffset: 1 })).rejects.toThrow("WRITE_OUTPUT");
      expect(calls).toBe(0);
    } finally { await smallClient.close(); await bigClient.close(); }
  });
  test("backend exceptions cannot leak credentials into tool responses", async () => {
    const client = await connection(defaultCatalogue, async () => { throw new Error("sensitive credential trace"); });
    try {
      const result = await client.callTool({ name: "capabilities_execute", arguments: { name: "announcements_list" } });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain("sensitive");
    } finally { await client.close(); }
  });
  test("authorization rejects non-loopback redirects and weak PKCE/state", () => {
    const base = new URLSearchParams({ client_id: "pi-announcements", response_type: "code", redirect_uri: "http://127.0.0.1:45678/callback", scope: "admin:manage", code_challenge_method: "S256", code_challenge: "c".repeat(43), state: "s".repeat(43) });
    expect(validateAuthorization(base).clientId).toBe("pi-announcements");
    for (const [key, value] of [["redirect_uri", "https://attacker.test/callback"], ["code_challenge_method", "plain"], ["state", ""], ["scope", "all"]]) {
      const bad = new URLSearchParams(base); bad.set(key, value); expect(() => validateAuthorization(bad)).toThrow();
    }
  });
});

test("large write outputs never invite replay through a continuation offset", async () => {
  let executions = 0;
  const result = await executeCapability({ async execute() { executions++; return { value: "x".repeat(20_000) }; } }, defaultCatalogue, { name: "announcements_create", input: { name: "X", bannerText: "Y" } });
  expect(executions).toBe(1); expect(result).toMatchObject({ nextOffset: null, resultTruncated: true });
});

test("prototype properties are not capabilities", async () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    expect(() => describeCapabilities(defaultCatalogue, { names: [name] })).toThrow("UNKNOWN_CAPABILITY");
    await expect(executeCapability({ async execute() { throw new Error("Must not execute"); } }, defaultCatalogue, { name, input: {} })).rejects.toThrow("UNKNOWN_CAPABILITY");
  }
});
