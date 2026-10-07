import { checkEdgeRateLimit } from "@web-app-starter/edge-rate-limit";
import { privateJson } from "./config";
/** POC process-wide ingress budget, including invalid requests before backend work. */
export function agentRateLimit(): Response | null {
  const result = checkEdgeRateLimit("agentic-ingress", { windowSeconds: 60, maxRequests: 250, maxMapSize: 10000 });
  return result.allowed ? null : privateJson({ error: "rate_limited" }, 429, { "Retry-After": "60" });
}
