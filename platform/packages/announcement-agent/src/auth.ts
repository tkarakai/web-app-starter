import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { CLIENT_ID, SCOPE } from "@web-app-starter/agentic/oauth";

/** Browser credentials never enter the harness. The returned grant stays in process memory. */
export async function authenticate(origin: string): Promise<string> {
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))))
    throw new Error("Use an HTTPS admin origin or a local loopback origin, without a trailing slash.");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let accept!: (code: string) => void;
  let reject!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail; });
  const server = createServer((request, response) => {
    const callback = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || callback.pathname !== "/callback" || callback.searchParams.get("state") !== state) {
      response.writeHead(400); response.end("Invalid callback"); return;
    }
    if (callback.searchParams.get("error") === "access_denied") {
      response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      response.end("Access denied. No authorization was granted. You can close this tab.");
      reject(new Error("Announcement access was denied. Use /auth to try again."));
      return;
    }
    const code = callback.searchParams.get("code");
    if (!code || !/^[a-f0-9]{64}$/.test(code)) { response.writeHead(400); response.end("No authorization code"); return; }
    response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    response.end("Authenticated. Return to the announcement agent terminal. You can close this tab.");
    accept(code);
  });
  await new Promise<void>((resolve, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot start callback listener");
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const resource = `${origin}/api/mcp`;
  const authorization = new URL(`${origin}/api/agent/authorize`);
  authorization.search = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", redirect_uri: redirectUri,
    scope: SCOPE, code_challenge_method: "S256", code_challenge: challenge, state, resource }).toString();
  process.stdout.write(`Sign in and approve announcement access in your browser:\n${authorization.href}\n`);
  if (process.env.AGENT_NO_OPEN !== "true") {
    const child = spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open", [authorization.href], { stdio: "ignore" });
    child.on("error", () => {}); child.unref();
  }
  const timeout = setTimeout(() => reject(new Error("Authentication timed out. Restart or use /auth to try again.")), 5 * 60_000);
  try {
    const code = await codePromise;
    const response = await fetch(`${origin}/api/agent/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT_ID, redirect_uri: redirectUri, resource }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Authorization exchange failed. Sign in again and retry.");
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || !("access_token" in result) || typeof result.access_token !== "string") throw new Error("Invalid token response");
    return result.access_token;
  } finally { clearTimeout(timeout); server.close(); }
}
