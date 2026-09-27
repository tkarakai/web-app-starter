import * as http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { demand } from "../platform-upgrade/metadata.ts";
import { api, gh, parseApp, storeApp, verifyInstallation, PERMISSIONS, type Api, type App, type Gh, type Repository } from "./github.ts";

function escape(text: string): string { return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
export function appManifest(repo: Repository, origin: string, state: string): Record<string, unknown> {
  const callback = origin + "/callback", setup = origin + "/installed?state=" + state;
  return { name: repo.full_name.split("/")[1].slice(0, 15) + "-updater-" + state.slice(0, 6), url: "https://github.com/" + repo.full_name, description: "Deliver verified platform update PRs to " + repo.full_name, public: false, redirect_url: callback, setup_url: setup, hook_attributes: { url: "https://github.com/" + repo.full_name, active: false }, default_events: [], default_permissions: PERMISSIONS };
}
function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;background:#fafaf9;color:#292524;margin:0;padding:32px}main{max-width:640px;margin:8vh auto;background:white;border:1px solid #e7e5e4;border-radius:16px;padding:32px;overflow-wrap:anywhere}h1{line-height:1.15;font-size:30px}button,a.button{display:inline-block;background:#0f766e;color:white;border:0;border-radius:8px;padding:12px 18px;font:inherit;text-decoration:none;cursor:pointer}a{color:#0f766e}small{color:#57534e}form{margin-top:24px}</style><main><h1>${escape(title)}</h1>${content}</main></html>`;
}
export async function startSetup(options: { repo: Repository; request?: Api; run?: Gh; timeoutMs?: number }): Promise<{ url: string; done: Promise<{ id: number; slug: string }>; close: () => void }> {
  const state = randomBytes(32).toString("hex"), request = options.request ?? api, run = options.run ?? gh;
  let app: App | undefined, origin = "", consumed = false, busy = false, settled = false;
  let resolve!: (result: { id: number; slug: string }) => void, reject!: (error: Error) => void;
  const done = new Promise<{ id: number; slug: string }>((yes, no) => { resolve = yes; reject = no; });
  // Attach a handler while the caller is receiving the server handle; the caller still awaits done.
  void done.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (timer) clearTimeout(timer); if (app) app.pem = ""; server.close(); server.closeIdleConnections(); };
  const finish = (error?: Error) => { if (settled) return; settled = true; if (error) reject(error); else resolve({ id: app!.id, slug: app!.slug }); stop(); };
  const server = http.createServer((req, res) => {
    const send = (status: number, title: string, content: string) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com 'self'; base-uri 'none'; frame-ancestors 'none'" }); res.end(page(title, content)); };
    void (async () => {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return send(403, "Request refused", "<p>Return to the setup URL printed in your terminal.</p>");
      const url = new URL(req.url ?? "/", origin), received = url.searchParams.getAll("state");
      if (received.length !== 1 || !/^[0-9a-f]{64}$/.test(received[0]) || !timingSafeEqual(Buffer.from(received[0]), Buffer.from(state))) return send(403, "Request refused", "<p>Setup state is missing or invalid.</p>");
      if (settled) return send(410, "Setup closed", "<p>Return to your terminal.</p>");
      if (req.method === "GET" && url.pathname === "/") {
        const endpoint = options.repo.owner.type === "Organization" ? "https://github.com/organizations/" + options.repo.owner.login + "/settings/apps/new" : "https://github.com/settings/apps/new";
        const manifest = JSON.stringify(appManifest(options.repo, origin, state));
        return send(200, "Set up platform updates", `<p>Create a private GitHub App owned by <strong>${escape(options.repo.owner.login)}</strong> for <strong>${escape(options.repo.full_name)}</strong>.</p><p>It needs Contents, Pull requests, Workflows and Issues write access to deliver update PRs. On the installation screen, select only this repository.</p><form method="post" action="${endpoint}?state=${state}"><input type="hidden" name="manifest" value="${escape(manifest)}"><button>Create the GitHub App</button></form><p><small>The private key stays in this helper's memory until it is stored as an encrypted repository secret. Leave the terminal open.</small></p>`);
      }
      if (req.method === "GET" && url.pathname === "/callback") {
        if (consumed || busy) return send(409, "Registration already received", "<p>Use the installation link from the first callback tab.</p>");
        const codes = url.searchParams.getAll("code");
        if (codes.length !== 1 || !/^[A-Za-z0-9_-]{20,200}$/.test(codes[0])) return send(400, "Invalid registration code", "<p>Restart setup from your terminal.</p>");
        consumed = true; busy = true;
        try {
          const registered = parseApp(await request("POST", "/app-manifests/" + codes[0] + "/conversions"));
          if (settled) { registered.pem = ""; return send(410, "Setup closed", "<p>Return to your terminal.</p>"); }
          app = registered;
        }
        catch { send(502, "Registration exchange failed", "<p>No credentials were logged. Restart setup; check your GitHub App settings for an unused registration.</p>"); finish(Error("GitHub App registration exchange failed. Check your App settings before restarting.")); return; }
        finally { busy = false; }
        return send(200, "Install your updater", `<p>Select only <strong>${escape(options.repo.full_name)}</strong> when installing this App.</p><p><a class="button" href="https://github.com/apps/${app.slug}/installations/new">Install the GitHub App</a></p><p>After installation, GitHub returns here. If it does not, use this button.</p><form method="post" action="/installed?state=${state}"><button>Verify installation and save</button></form>`);
      }
      if (["GET", "POST"].includes(req.method ?? "") && url.pathname === "/installed") {
        if (!app || busy) return send(409, "Not ready", "<p>Complete registration first, or wait for the current verification.</p>");
        busy = true;
        try {
          await verifyInstallation(app, options.repo, request);
          if (settled) return send(410, "Setup closed", "<p>Return to your terminal.</p>");
          storeApp(app, options.repo.full_name, run);
          send(200, "Platform updates configured", `<p>The App is installed on <strong>${escape(options.repo.full_name)}</strong>. Its ID and encrypted private key are stored in that repository.</p><p>Commit your update caller if it was added, then run <strong>Actions → Update platform</strong> to check for releases. You can close this page.</p>`); finish();
        } catch (error) {
          send(409, "Setup needs attention", `<p>${escape(error instanceof Error ? error.message : "Verification failed")}</p><p><a href="https://github.com/apps/${app.slug}/installations/new">Review the App installation</a>, then retry.</p><form method="post" action="/installed?state=${state}"><button>Verify installation and save</button></form>`);
        } finally { busy = false; }
        return;
      }
      send(404, "Not found", "<p>Return to the setup tab.</p>");
    })().catch(() => { if (!res.headersSent) send(500, "Setup failed", "<p>Return to your terminal. No credential values were logged.</p>"); });
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", () => { server.off("error", no); yes(); }); });
  const address = server.address(); demand(address && typeof address === "object", "Could not start loopback setup server"); origin = "http://127.0.0.1:" + address.port;
  timer = setTimeout(() => finish(Error("Updater setup timed out. Restart within GitHub's one-hour registration window.")), options.timeoutMs ?? 55 * 60_000);
  return { url: origin + "/?state=" + state, done, close: () => finish(Error("Updater setup cancelled. No credential values were logged.")) };
}
