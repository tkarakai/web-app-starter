"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useQuery } from "convex/react";
import { api } from "@repo/backend";
import { catalogueFromRows } from "@web-app-starter/agentic/discovery";
import { browserCatalogue, withBrowserCapabilities } from "@web-app-starter/agentic/browser-catalogue";
import { browserActions } from "@web-app-starter/agentic/browser-actions";
import { registerWebMcp, type ModelContextProvider } from "@web-app-starter/agentic/webmcp";

/** Mounted only inside the protected normal admin layout; never on the authorization origin. */
export function AgentBrowserBridge() {
  const client = useConvex(); const router = useRouter();
  const configuration = useQuery(api.platform.agentSurfaces.configuration, {});
  const enabled = configuration?.surfaces.webmcp?.enabled ?? false;
  useEffect(() => {
    const provider = (document as typeof document & { modelContext?: ModelContextProvider }).modelContext;
    if (!enabled || !provider) return;
    const controller = new globalThis.AbortController();
    const page = browserActions(document, path => router.push(path));
    const authorize = async () => { await client.query(api.platform.agentCapabilities.browserPermit, { requestId: crypto.randomUUID() }); };
    async function register() {
      const rows = await client.query(api.platform.agentCapabilities.browserCatalogue, {});
      const catalogue = withBrowserCapabilities(catalogueFromRows(rows));
      await registerWebMcp(provider!, catalogue, { async execute(name, input, signal) {
        if (signal?.aborted || controller.signal.aborted) throw new Error("SURFACE_DISABLED");
        const definition = catalogue[name]; if (!definition) throw new Error("UNKNOWN_CAPABILITY");
        if (browserCatalogue[name]) return page(name, input);
        const args = { name, input };
        return definition.effect === "write" ? client.mutation(api.platform.agentCapabilities.browserWrite, args) : client.query(api.platform.agentCapabilities.browserRead, args);
      } }, authorize, controller.signal);
    }
    void register().catch(() => { controller.abort(); });
    return () => controller.abort();
  }, [client, enabled, router]);
  return null;
}
