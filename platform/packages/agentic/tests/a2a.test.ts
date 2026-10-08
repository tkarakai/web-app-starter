import { expect, test } from "bun:test";
import { A2A_VERSION, a2aAgentCard, a2aWireValue, messageRequest, validateCommand } from "../src/a2a";
import { announcementCatalogue } from "./fixtures/catalogue";
test("A2A released wire binding, card and part contracts match the v1 types", () => {
  expect(A2A_VERSION).toBe("1.0");
  const card = a2aAgentCard("http://localhost:3002", "http://mcp-auth.localhost:3002", "Example");
  expect(card.supportedInterfaces).toEqual([{ url: "http://localhost:3002/api/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }]);
  expect(card.securityRequirements[0]?.schemes.adminOAuth.list).toEqual(["admin:manage"]);
  expect(card.capabilities.streaming).toBe(false);
  const base = { message: { messageId: "test", role: "ROLE_USER", parts: [{ text: "Help" }] } };
  expect(messageRequest.parse(base).configuration).toBeUndefined();
  expect(() => messageRequest.parse({ message: { ...base.message, parts: [{ text: "Help", data: {} }] } })).toThrow();
  expect(() => messageRequest.parse({ message: { ...base.message, parts: [{}] } })).toThrow();
  expect(() => validateCommand({ operation: "execute", input: { name: "announcements_create", input: { name: "X", bannerText: "Y", token: "INJECTED" } } }, announcementCatalogue)).toThrow();
});
test("JSON Schema dollar keys survive durable text storage and become structured A2A data only at HTTP boundary", () => {
  const artifact = { artifactId: "one", parts: [{ text: JSON.stringify({ inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", $defs: { example: {} } } }), mediaType: "application/json" }] };
  const result = a2aWireValue({ task: { id: "one", artifacts: [artifact] } });
  expect(result).toMatchObject({ task: { artifacts: [{ parts: [{ data: { inputSchema: { $defs: { example: {} } } } }] }] } });
  expect(a2aWireValue({ tasks: [{ id: "one", artifacts: [artifact] }] })).toMatchObject({ tasks: [{ artifacts: [{ parts: [{ data: expect.anything() }] }] }] });
});
