import { afterEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
const original = process.env.AGENT_MCP_AUTH_ORIGIN;
afterEach(() => { if (original === undefined) delete process.env.AGENT_MCP_AUTH_ORIGIN; else process.env.AGENT_MCP_AUTH_ORIGIN = original; });
test("the auth-only host refuses normal pages and APIs even when the MCP transport is disabled", () => {
  process.env.AGENT_MCP_AUTH_ORIGIN = "http://mcp-auth.localhost:3002";
  for (const path of ["/", "/dashboard", "/manage/announcements", "/configure/features", "/settings/agent-grants", "/api/mcp", "/api/auth/admin/list-users", "/api/auth/change-password", "/api/auth/sign-up/email"]) {
    const request = new NextRequest("http://mcp-auth.localhost:3002" + path, { headers: { "next-router-prefetch": "1" } });
    expect(proxy(request)?.status).toBe(404);
  }
  expect(proxy(new NextRequest("http://mcp-auth.localhost:3002/api/auth/sign-in/email", { method: "POST" }))?.status).toBe(200);
});
