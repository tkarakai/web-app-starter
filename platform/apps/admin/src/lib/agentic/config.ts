/** Canonical resource and issuer origins are separate; neither is derived from Host. */
function origin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
    return url.origin === value && (url.protocol === "https:" || url.protocol === "http:" && loopback) ? url : null;
  } catch { return null; }
}
export function agentConfig() {
  if (process.env.AGENT_MCP_ENABLED !== "true") return null;
  const admin = origin(process.env.AGENT_MCP_ORIGIN);
  const issuer = origin(process.env.AGENT_MCP_AUTH_ORIGIN);
  // Cookies are scoped to hosts, not ports. Distinct ports alone do not isolate sessions.
  if (!admin || !issuer || admin.hostname === issuer.hostname) return null;
  return { origin: admin.origin, resource: `${admin.origin}/api/mcp`, authorizationOrigin: issuer.origin };
}
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}
export function allowedRequest(request: Request, origin: string) {
  return requestOrigin(request) === origin && (!request.headers.has("origin") || request.headers.get("origin") === origin);
}
export function authorizationOrigin() { return origin(process.env.AGENT_MCP_AUTH_ORIGIN)?.origin ?? null; }
export function isAuthorizationHost(host: string | null) {
  const issuer = authorizationOrigin();
  return Boolean(issuer && host === new URL(issuer).host);
}
export function privateJson(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
