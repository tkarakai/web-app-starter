import { afterEach, expect, test, vi } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { searchCapabilities, describeCapabilities, executeCapability } from "@web-app-starter/agentic/discovery";

vi.mock("@repo/backend", () => ({ api: { platform: { agentAccess: { inspect: "inspect" }, agentCapabilities: { catalogue: "catalogue", read: "read", write: "write" } } } }));
import { convexCatalogue, convexAdapter } from "../../src/lib/agentic/convex-adapter";

afterEach(() => vi.restoreAllMocks());

test("two clients share structural schemas but never cached authorization or operator results", async () => {
  const first = new ConvexHttpClient("http://127.0.0.1:35981");
  const second = new ConvexHttpClient("http://127.0.0.1:35981");
  const resource = "http://localhost:3002/api/agent/cli";
  const allowed = new Set(["operator-a", "operator-b"]);
  const rows = [{ name: "organizations_get", title: "Organization metadata", description: "Organization control projection", effect: "read" as const, inputSchema: { type: "object", properties: { organizationId: { type: "string" } }, required: ["organizationId"], additionalProperties: false } }];
  const operations: { client: string; reference: unknown; token: string }[] = [];
  for (const [label, client] of [["a", first], ["b", second]] as const) {
    vi.spyOn(client, "query").mockImplementation(async (reference, args = {}) => {
      const token = (args as { token: string }).token;
      operations.push({ client: label, reference, token });
      if (!allowed.has(token)) throw new Error("INVALID_AGENT_TOKEN");
      if (String(reference) === "catalogue") return rows;
      if (String(reference) === "inspect") return { scope: "admin:manage", recent: true };
      return { organizationId: (args as { input: { organizationId: string } }).input.organizationId, name: "Public organization", contacts: [] };
    });
  }
  const catalogueA = await convexCatalogue(first, "operator-a", resource);
  const catalogueB = await convexCatalogue(second, "operator-b", resource);
  expect(catalogueB).toBe(catalogueA);
  expect(operations.filter(item => item.reference === "catalogue")).toHaveLength(1);
  expect(operations.filter(item => item.reference === "inspect").map(item => item.client)).toEqual(["a", "b"]);
  expect(searchCapabilities(catalogueB, { query: "organizations" }).matches[0].name).toBe("organizations_get");
  expect(describeCapabilities(catalogueB, { names: ["organizations_get"] })[0].effect).toBe("read");
  const adapterA = convexAdapter(first, "operator-a", resource, catalogueA);
  const adapterB = convexAdapter(second, "operator-b", resource, catalogueB);
  const command = { name: "organizations_get", input: { organizationId: "org-public" } };
  expect(await executeCapability(adapterA, catalogueA, command)).toMatchObject({ result: { organizationId: "org-public" } });
  allowed.delete("operator-a");
  await expect(convexCatalogue(first, "operator-a", resource)).rejects.toThrow("INVALID_AGENT_TOKEN");
  await expect(convexCatalogue(second, "ordinary-or-enrolled-org-admin", resource)).rejects.toThrow("INVALID_AGENT_TOKEN");
  // Holding a described schema/adapter does not bypass fresh execution authority.
  await expect(executeCapability(adapterA, catalogueA, command)).rejects.toThrow("INVALID_AGENT_TOKEN");
  expect(await executeCapability(adapterB, catalogueB, command)).toMatchObject({ result: { organizationId: "org-public" } });
  expect(operations.filter(item => item.reference === "catalogue")).toHaveLength(1);
  expect(JSON.stringify(catalogueA)).not.toContain("operator-a");
  expect(JSON.stringify(catalogueA)).not.toContain("org-public");
});
