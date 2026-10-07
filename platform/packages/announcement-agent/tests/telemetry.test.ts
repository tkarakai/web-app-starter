import { expect, test } from "bun:test";
import { instrumentConnection, type ToolEvidence } from "../src/telemetry";

test("pi evidence records outcomes and hashes without application content or credentials", async () => {
  const evidence: ToolEvidence[] = [];
  const client = instrumentConnection({ async listTools() { return { tools: [] }; }, async close() {}, async callTool() { return { content: [{ type: "text", text: JSON.stringify({ result: { id: "record-id", bannerText: "PRIVATE_APPLICATION_CONTENT" } }) }] }; } }, evidence);
  await client.callTool({ name: "capabilities_execute", arguments: { name: "announcements_create", input: { name: "PRIVATE_DRAFT_NAME", bannerText: "PRIVATE_APPLICATION_CONTENT" } } });
  await client.callTool({ name: "capabilities_execute", arguments: { name: "announcements_get", input: { announcementId: "record-id" } } });
  expect(evidence[0]).toMatchObject({ success: true, createdAnnouncementId: "record-id", nameHash: expect.any(String) });
  expect(evidence[1]).toMatchObject({ announcementId: "record-id", bannerHash: expect.any(String) });
  expect(JSON.stringify(evidence)).not.toContain("PRIVATE_");
  const failing = instrumentConnection({ async listTools() { return { tools: [] }; }, async close() {}, async callTool() { return { isError: true, content: [{ type: "text", text: "RECENT_AUTHENTICATION_REQUIRED" }] }; } }, evidence);
  expect((await failing.callTool({ name: "capabilities_execute", arguments: { name: "announcements_create" } })).isError).toBe(true);
  expect(evidence.at(-1)?.success).toBe(false);
});
