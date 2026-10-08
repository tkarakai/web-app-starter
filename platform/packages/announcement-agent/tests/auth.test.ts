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

for (const surface of ["mcp", "cli", "a2a"] as const) {
  for (const exchange of ["success", "rejected", "malformed"] as const) {
    test(`${surface} loopback callback reports ${exchange} only after the HTTP token exchange`, async () => {
      process.env.AGENT_NO_OPEN = "true";
      const { createServer } = await import("node:http");
      const { createHash } = await import("node:crypto");
      const { CLIENT_ID, SCOPE } = await import("@web-app-starter/agentic/oauth");
      const path = surface === "mcp" ? "/api/mcp" : surface === "cli" ? "/api/agent/cli" : "/api/a2a";
      const code = "b2".repeat(32);
      const token = "private-loopback-test-grant";
      let receive!: (url: URL) => void;
      const requested = new Promise<URL>(resolve => { receive = resolve; });
      let receivedBody!: (body: URLSearchParams) => void;
      const tokenRequest = new Promise<URLSearchParams>(resolve => { receivedBody = resolve; });
      let release!: () => void;
      const released = new Promise<void>(resolve => { release = resolve; });
      let exchanges = 0;
      let origin: string;
      const issuer = createServer(async (request, response) => {
        response.setHeader("Content-Type", "application/json");
        if (request.url === `/.well-known/oauth-protected-resource${path}`) {
          response.end(JSON.stringify({ resource: origin + path, authorization_servers: [origin] }));
        } else if (request.url === "/.well-known/oauth-authorization-server") {
          response.end(JSON.stringify({ issuer: origin, authorization_endpoint: origin + "/api/agent/authorize", token_endpoint: origin + "/api/agent/token" }));
        } else if (request.url === "/api/agent/token" && request.method === "POST") {
          exchanges++;
          let body = "";
          for await (const chunk of request) body += chunk;
          receivedBody(new URLSearchParams(body));
          await released;
          response.statusCode = exchange === "rejected" ? 400 : 200;
          response.end(JSON.stringify(exchange === "success" ? { access_token: token }
            : exchange === "rejected" ? { error: "invalid_grant", error_description: code }
              : { access_token: 123, private_detail: token }));
        } else {
          response.statusCode = 404;
          response.end("{}");
        }
      });
      await new Promise<void>(resolve => issuer.listen(0, "127.0.0.1", resolve));
      const address = issuer.address();
      if (!address || typeof address === "string") throw new Error("Cannot start test issuer");
      origin = `http://127.0.0.1:${address.port}`;
      const output = spyOn(process.stdout, "write").mockImplementation(chunk => {
        const url = String(chunk).split("\n").find(line => line.startsWith(origin + "/api/agent/authorize?"));
        if (url) receive(new URL(url));
        return true;
      });
      const outcome = authenticate(origin, surface).then(grant => ({ grant, error: "" }),
        error => ({ grant: "", error: error instanceof Error ? error.message : "error" }));
      try {
        const authorization = await requested;
        expect(authorization.searchParams.get("scope")).toBe(SCOPE);
        expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.search = new URLSearchParams({ code, state: authorization.searchParams.get("state")! }).toString();
        let callbackCompleted = false;
        const callbackResponse = fetch(callback).then(response => { callbackCompleted = true; return response; });
        const body = await tokenRequest;
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("client_id")).toBe(CLIENT_ID);
        expect(body.get("code")).toBe(code);
        expect(body.get("resource")).toBe(origin + path);
        expect(body.get("redirect_uri")).toBe(authorization.searchParams.get("redirect_uri"));
        expect(body.get("code_verifier")).toHaveLength(43);
        expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"))
          .toBe(authorization.searchParams.get("code_challenge") ?? "");
        const replay = await fetch(callback);
        expect(replay.status).toBe(400);
        expect(exchanges).toBe(1);
        expect(callbackCompleted).toBe(false);
        release();
        const response = await callbackResponse;
        expect(response.status).toBe(exchange === "success" ? 200 : 502);
        expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        const page = await response.text();
        const style = page.match(/<style>([\s\S]*?)<\/style>/)![1];
        expect(response.headers.get("Content-Security-Policy"))
          .toBe(`default-src 'none'; style-src 'sha256-${createHash("sha256").update(style).digest("base64")}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
        expect(page).toContain(exchange === "success" ? "<h1>Authenticated</h1>" : "<h1>Authorization not completed</h1>");
        if (exchange !== "success") {
          expect(page).toContain("Your agent is not connected");
          expect(page).not.toContain("<h1>Authenticated</h1>");
        }
        for (const secret of [code, token, authorization.searchParams.get("state")!, body.get("code_verifier")!]) {
          expect(page).not.toContain(secret);
        }
        expect(page).not.toContain("<script");
        const result = await outcome;
        expect(result.grant).toBe(exchange === "success" ? token : "");
        expect(result.error).toBe(exchange === "success" ? "" : exchange === "rejected"
          ? "Authorization exchange failed. Sign in again and retry." : "Invalid token response");
        await expect(fetch(callback)).rejects.toThrow();
      } finally {
        release();
        output.mockRestore();
        await new Promise<void>((resolve, reject) => issuer.close(error => error ? reject(error) : resolve()));
      }
    });
  }
}
