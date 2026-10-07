import { test } from "node:test";
import assert from "node:assert/strict";
import { localAgentOrigins } from "../agentic-origins.ts";
test("MCP dev uses a distinct cookie host on the existing admin listener", () => {
  assert.deepEqual(localAgentOrigins("http://localhost:43202"), { origin: "http://localhost:43202", authorizationOrigin: "http://mcp-auth.localhost:43202", resource: "http://localhost:43202/api/mcp" });
  assert.throws(() => localAgentOrigins("http://localhost:43202", undefined, "http://localhost:43203"));
  assert.throws(() => localAgentOrigins("http://localhost:43202", undefined, "https://auth.example.test"));
  assert.throws(() => localAgentOrigins("http://localhost:43202", "http://localhost:43201"));
});

test("local issuer hostnames cannot inject shell syntax into launcher assignments", () => {
  assert.throws(() => localAgentOrigins("http://localhost:43202", undefined, "http://a'$(command).localhost:43202"));
});
