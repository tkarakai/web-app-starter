"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useQuery } from "convex/react";
import { api } from "@repo/backend";
import { browserActions } from "@web-app-starter/agentic/browser-actions";
import { boundedResult } from "@web-app-starter/agentic/results";
import { registerWebMcp, type ModelContextProvider } from "@web-app-starter/agentic/webmcp";
/** Only the protected normal admin layout mounts this browser-safe binding. */
export function AgentBrowserBridge() {
  const client = useConvex(); const router = useRouter();
  const configuration = useQuery(api.platform.agentSurfaces.configuration, {});
  const enabled = configuration?.surfaces.webmcp?.enabled ?? false;
  useEffect(() => {
    const provider = (document as typeof document & { modelContext?: ModelContextProvider }).modelContext;
    if (!enabled || !provider) return;
    const controller = new globalThis.AbortController(); const page = browserActions(document, path => router.push(path));
    void registerWebMcp(provider, async (name, input, signal) => {
      const operation = name === "capabilities_search" ? "search" : name === "capabilities_describe" ? "describe" : "prepare";
      const response = await client.query(api.platform.agentCapabilities.browserGateway, { operation, input, requestId: crypto.randomUUID() });
      if (controller.signal.aborted || signal?.aborted) throw new Error("SURFACE_DISABLED");
      const value = JSON.parse(response);
      if (operation !== "prepare") return value;
      const request = value as { name: string; input: Record<string, unknown>; effect: string; resultOffset: number };
      if (request.effect === "browser") return boundedResult(await page(request.name, request.input));
      const args = { name: request.name, input: request.input };
      const result = request.effect === "write" ? await client.mutation(api.platform.agentCapabilities.browserWrite, args) : await client.query(api.platform.agentCapabilities.browserRead, args);
      const output = boundedResult(result, request.resultOffset);
      if (request.effect !== "read" && output.nextOffset !== undefined && output.nextOffset !== null) return { ...output, nextOffset: null, resultTruncated: true };
      return output;
    }, controller.signal).catch(() => controller.abort());
    return () => controller.abort();
  }, [client, enabled, router]);
  return null;
}
