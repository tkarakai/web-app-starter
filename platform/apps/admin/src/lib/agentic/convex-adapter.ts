import { ConvexHttpClient } from "convex/browser";
import { catalogueFromRows } from "@web-app-starter/agentic/discovery";
import { api } from "@repo/backend";
import type { CapabilityAdapter } from "@web-app-starter/agentic/adapter";
import type { CapabilityCatalogue } from "@web-app-starter/agentic/discovery";
export function backendClient() {
  const url = process.env.CONVEX_URL;
  if (!url) throw new Error("CONVEX_URL is required");
  return new ConvexHttpClient(url);
}
export async function convexCatalogue(client: ConvexHttpClient, token: string, resource: string): Promise<CapabilityCatalogue> {
  const rows = await client.query(api.platform.agentCapabilities.catalogue, { token, resource });
  return catalogueFromRows(rows);
}
export function convexAdapter(client: ConvexHttpClient, token: string, resource: string, catalogue: CapabilityCatalogue): CapabilityAdapter {
  return { async execute(name, input, signal) {
    if (signal?.aborted) throw new Error("ABORTED");
    const definition = catalogue[name];
    if (!definition) throw new Error("UNKNOWN_CAPABILITY");
    const args = { token, resource, name, input: definition.schema.parse(input) };
    return definition.effect === "write" ? client.mutation(api.platform.agentCapabilities.write, args) : client.query(api.platform.agentCapabilities.read, args);
  } };
}
