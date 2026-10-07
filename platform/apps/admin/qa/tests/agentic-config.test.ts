import { afterEach, expect, test } from "bun:test";
import { agentConfig, allowedRequest } from "../../src/lib/agentic/config";
const saved = { enabled: process.env.AGENT_MCP_ENABLED, origin: process.env.AGENT_MCP_ORIGIN, issuer: process.env.AGENT_MCP_AUTH_ORIGIN };
afterEach(() => {
  if (saved.issuer === undefined) delete process.env.AGENT_MCP_AUTH_ORIGIN; else process.env.AGENT_MCP_AUTH_ORIGIN = saved.issuer;
  if (saved.enabled === undefined) delete process.env.AGENT_MCP_ENABLED; else process.env.AGENT_MCP_ENABLED = saved.enabled;
  if (saved.origin === undefined) delete process.env.AGENT_MCP_ORIGIN; else process.env.AGENT_MCP_ORIGIN = saved.origin;
});
test("MCP fails closed on disabled, missing or unsafe origin configuration", () => {
  delete process.env.AGENT_MCP_ENABLED;
  expect(agentConfig()).toBeNull();
  process.env.AGENT_MCP_ENABLED = "true";
  process.env.AGENT_MCP_AUTH_ORIGIN = "http://mcp-auth.localhost:3002";
  for (const origin of ["", "invalid", "http://example.test", "https://example.test/path", "https://user@example.test", "https://example.test/"]) {
    process.env.AGENT_MCP_ORIGIN = origin;
    expect(agentConfig()).toBeNull();
  }
  process.env.AGENT_MCP_ORIGIN = "http://localhost:3002";
  expect(agentConfig()?.resource).toBe("http://localhost:3002/api/mcp");
  process.env.AGENT_MCP_AUTH_ORIGIN = "http://localhost:3004";
  expect(agentConfig()).toBeNull();
});
test("canonical host and same-origin browser requests are enforced", () => {
  const origin = "http://localhost:3002";
  expect(allowedRequest(new Request(origin + "/api/mcp"), origin)).toBe(true);
  expect(allowedRequest(new Request(origin + "/api/mcp", { headers: { Origin: origin } }), origin)).toBe(true);
  expect(allowedRequest(new Request(origin + "/api/mcp", { headers: { Origin: "https://attacker.test" } }), origin)).toBe(false);
  expect(allowedRequest(new Request("http://attacker.test/api/mcp"), origin)).toBe(false);
});

test("a normalized localhost URL still validates the original auth Host header", () => {
  const request = new Request("http://localhost:3002/api/agent/authorize", { headers: { host: "mcp-auth.localhost:3002" } });
  expect(allowedRequest(request, "http://mcp-auth.localhost:3002")).toBe(true);
  expect(allowedRequest(request, "http://localhost:3002")).toBe(false);
});
