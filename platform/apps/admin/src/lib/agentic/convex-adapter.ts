import { CatalogueCache } from "@web-app-starter/agentic/catalogue-cache";
import { withBrowserCapabilities } from "@web-app-starter/agentic/browser-catalogue";
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
const metadataCache = new CatalogueCache();
export async function convexCatalogue(client: ConvexHttpClient, token: string, resource: string): Promise<CapabilityCatalogue> {
  return metadataCache.get(client.url, async () => { await client.query(api.platform.agentAccess.inspect, { token, resource }); }, async () => {
    const rows = await client.query(api.platform.agentCapabilities.catalogue, { token, resource });
    return withBrowserCapabilities(catalogueFromRows(rows));
  });
}
export function convexAdapter(client: ConvexHttpClient, token: string, resource: string, catalogue: CapabilityCatalogue): CapabilityAdapter {
  return { async execute(name, input, signal) {
    if (signal?.aborted) throw new Error("ABORTED");
    const definition = Object.prototype.hasOwnProperty.call(catalogue, name) ? catalogue[name] : undefined;
    if (!definition) throw new Error("UNKNOWN_CAPABILITY");
    const args = { token, resource, name, input: definition.schema.parse(input) };
    if (definition.effect === "browser") {
      await client.query(api.platform.agentAccess.inspect, { token, resource });
      return { status: "requires_browser", executed: false, instructions: "This capability controls live page state. Use WebMCP in an authenticated app-operator page with its feature enabled; a remote data connection cannot manipulate an unconnected browser." };
    }
    return definition.effect === "write" ? client.mutation(api.platform.agentCapabilities.write, args) : client.query(api.platform.agentCapabilities.read, args);
  } };
}
