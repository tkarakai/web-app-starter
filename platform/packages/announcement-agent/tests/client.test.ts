import { describe, expect, test } from "bun:test";
import { discoverTools, type AdminToolConnection } from "../src/client";

function connection(callTool: AdminToolConnection["callTool"]): AdminToolConnection {
  return {
    async listTools() {
      return { tools: [{ name: "capabilities_execute", title: "Execute capability", description: "Run an authorized operation", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } }] };
    },
    callTool,
    async close() {},
  };
}

describe("pi tool bridge", () => {
  test("preserves remote discovery metadata and forwards arguments and cancellation", async () => {
    const abort = new globalThis.AbortController();
    const calls: unknown[] = [];
    const remote = connection(async (...args) => {
      calls.push(args);
      return { content: [{ type: "text", text: "created" }] };
    });
    const [tool] = await discoverTools(() => remote);
    expect(tool.name).toBe("capabilities_execute");
    expect(tool.label).toBe("Execute capability");
    expect(tool.description).toBe("Run an authorized operation");
    expect(tool.parameters.required).toEqual(["name"]);
    expect(tool.executionMode).toBe("sequential");
    const result = await tool.execute("call-1", { name: "announcements_create" }, abort.signal, undefined, {} as never);
    expect(calls).toEqual([[{ name: "capabilities_execute", arguments: { name: "announcements_create" } }, undefined, { signal: abort.signal }]]);
    expect(JSON.parse((result.content[0].type === "text" ? result.content[0].text : ""))).toEqual({ content: [{ type: "text", text: "created" }] });
  });

  test("uses the renewed connection and preserves remote refusals", async () => {
    let active = connection(async () => { throw new Error("expired credential"); });
    const [tool] = await discoverTools(() => active);
    const failed = await tool.execute("call-1", {}, undefined, undefined, {} as never);
    expect((failed.content[0].type === "text" ? failed.content[0].text : "")).toContain("Use /auth");
    expect((failed.content[0].type === "text" ? failed.content[0].text : "")).toContain("checking whether the previous write succeeded");
    expect((failed.content[0].type === "text" ? failed.content[0].text : "")).not.toContain("expired credential");
    active = connection(async () => ({ isError: true, content: [{ type: "text", text: "Forbidden" }] }));
    const renewed = await tool.execute("call-2", {}, undefined, undefined, {} as never);
    expect(JSON.parse((renewed.content[0].type === "text" ? renewed.content[0].text : ""))).toEqual({ isError: true, content: [{ type: "text", text: "Forbidden" }] });
  });
});
