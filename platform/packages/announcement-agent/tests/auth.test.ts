import { afterEach, expect, spyOn, test } from "bun:test";
import { authenticate } from "../src/auth";
const previous = process.env.AGENT_NO_OPEN;
afterEach(() => { if (previous === undefined) delete process.env.AGENT_NO_OPEN; else process.env.AGENT_NO_OPEN = previous; });

test("explicit browser denial verifies state and closes the loopback authorization flow", async () => {
  process.env.AGENT_NO_OPEN = "true";
  let receive!: (url: URL) => void;
  const requested = new Promise<URL>(resolve => { receive = resolve; });
  const originalFetch = globalThis.fetch;
  const http = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/.well-known/oauth-protected-resource/api/mcp")) return Response.json({ resource: "http://localhost:3002/api/mcp", authorization_servers: ["http://mcp-auth.localhost:3002"] });
    if (url === "http://mcp-auth.localhost:3002/.well-known/oauth-authorization-server") return Response.json({ issuer: "http://mcp-auth.localhost:3002", authorization_endpoint: "http://mcp-auth.localhost:3002/api/agent/authorize", token_endpoint: "http://mcp-auth.localhost:3002/api/agent/token" });
    return originalFetch(input, init);
  }, { preconnect: originalFetch.preconnect }));
  const output = spyOn(process.stdout, "write").mockImplementation(chunk => {
    const url = String(chunk).split("\n").find(line => line.startsWith("http://mcp-auth.localhost:3002/api/agent/authorize?"));
    if (url) receive(new URL(url));
    return true;
  });
  const outcome = authenticate("http://localhost:3002").then(() => "unexpected grant", error => error instanceof Error ? error.message : "error");
  try {
    const request = await requested;
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ error: "access_denied", state: "wrong-state" }).toString();
    expect((await fetch(callback)).status).toBe(400);
    callback.searchParams.set("state", request.searchParams.get("state")!);
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const page = await response.text();
    expect(page).toContain("<h1>Access denied</h1>");
    expect(page).toContain("No authorization was granted");
    expect(page).not.toContain(request.searchParams.get("state")!);
    expect(await outcome).toContain("Admin access was denied");
  } finally { output.mockRestore(); http.mockRestore(); }
});

test("approved HTML callback preserves PKCE exchange and never renders the code or token", async () => {
  process.env.AGENT_NO_OPEN = "true";
  let receive!: (url: URL) => void;
  const requested = new Promise<URL>(resolve => { receive = resolve; });
  const originalFetch = globalThis.fetch;
  const code = "a1".repeat(32);
  const token = "secret-access-token-for-test";
  let exchanged = false;
  const http = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/.well-known/oauth-protected-resource/api/mcp")) return Response.json({ resource: "http://localhost:3002/api/mcp", authorization_servers: ["http://mcp-auth.localhost:3002"] });
    if (url === "http://mcp-auth.localhost:3002/.well-known/oauth-authorization-server") return Response.json({ issuer: "http://mcp-auth.localhost:3002", authorization_endpoint: "http://mcp-auth.localhost:3002/api/agent/authorize", token_endpoint: "http://mcp-auth.localhost:3002/api/agent/token" });
    if (url === "http://mcp-auth.localhost:3002/api/agent/token") {
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code")).toBe(code);
      expect(body.get("code_verifier")).toHaveLength(43);
      expect(body.get("resource")).toBe("http://localhost:3002/api/mcp");
      exchanged = true;
      return Response.json({ access_token: token });
    }
    return originalFetch(input, init);
  }, { preconnect: originalFetch.preconnect }));
  const output = spyOn(process.stdout, "write").mockImplementation(chunk => {
    const url = String(chunk).split("\n").find(line => line.startsWith("http://mcp-auth.localhost:3002/api/agent/authorize?"));
    if (url) receive(new URL(url));
    return true;
  });
  const outcome = authenticate("http://localhost:3002");
  try {
    const request = await requested;
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ code: "invalid", state: request.searchParams.get("state")! }).toString();
    const invalid = await fetch(callback);
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("<h1>Authorization not completed</h1>");
    expect(exchanged).toBe(false);
    callback.searchParams.set("code", code);
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const page = await response.text();
    expect(page).toContain("<h1>Authenticated</h1>");
    expect(page).toContain("Return to the admin agent terminal");
    expect(page).not.toContain(code);
    expect(page).not.toContain(token);
    expect(page).not.toContain(request.searchParams.get("state")!);
    expect(await outcome).toBe(token);
  } finally { output.mockRestore(); http.mockRestore(); }
});
