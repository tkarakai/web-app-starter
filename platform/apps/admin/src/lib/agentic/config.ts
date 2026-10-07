/** Explicit origin prevents Host-header-derived OAuth issuers or token audiences. */
export function agentConfig() {
  if (process.env.AGENT_MCP_ENABLED !== "true") return null;
  const raw = process.env.AGENT_MCP_ORIGIN;
  if (!raw) return null;
  const url = new URL(raw);
  if (url.origin !== raw || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
  return { origin: url.origin, resource: `${url.origin}/api/mcp` };
}
export function allowedRequest(request: Request, origin: string) {
  const url = new URL(request.url);
  return url.origin === origin && (!request.headers.has("origin") || request.headers.get("origin") === origin);
}
export function privateJson(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
