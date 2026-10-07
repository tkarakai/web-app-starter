import { createHash } from "node:crypto";

type Result = "approved" | "denied" | "invalid" | "failed";
const styles = `
:root{color-scheme:light dark;--background:#f5f5f4;--surface:#fff;--text:#292524;--muted:#78716c;--border:#e7e5e4;--accent:#287e79;--tint:#eaf5f2}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--background);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{width:100%;max-width:480px;background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:0 12px 40px #2925240a;overflow:hidden}
header{padding:22px 30px;border-bottom:1px solid var(--border);font-size:12px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.content{padding:36px 30px 30px}.symbol{display:grid;place-items:center;width:56px;height:56px;background:var(--tint);color:var(--accent);border-radius:50%;margin-bottom:24px}.symbol svg{width:28px;height:28px}
h1{font-size:28px;line-height:1.2;letter-spacing:-.035em;margin:0 0 14px;font-weight:650}p{font-size:15px;line-height:1.65;margin:0;color:var(--muted)}.next{margin-top:26px;padding:16px 18px;border:1px solid var(--border);border-radius:10px;font-size:14px;line-height:1.6}.next strong{display:block;font-weight:600}.next span{color:var(--muted)}
footer{padding:18px 30px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);overflow-wrap:anywhere}.denied,.invalid,.failed{--accent:#806325;--tint:#f8f2e5}
@media(prefers-color-scheme:dark){:root{--background:#1c1917;--surface:#292524;--text:#fafaf9;--muted:#a8a29e;--border:#44403c;--accent:#85c8bd;--tint:#24413c}.denied,.invalid,.failed{--accent:#e1c487;--tint:#443b29}}
@media(max-width:380px){body{padding:16px}header,footer{padding-inline:22px}.content{padding:28px 22px}h1{font-size:25px}}
`;
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Self-contained callback page: no scripts, remote assets, credentials or query reflection. */
export function authResultPage(result: Result, origin: string) {
  const approved = result === "approved";
  const title = approved ? "Authenticated" : result === "denied" ? "Access denied" : "Authorization not completed";
  const description = approved ? "Return to the admin agent terminal. You can close this tab."
    : result === "denied" ? "No authorization was granted. You can close this tab."
      : result === "failed" ? "The authorization code could not be exchanged for an access grant. Your agent is not connected."
        : "This authorization callback is invalid. No authorization was completed through this callback.";
  const next = approved ? "Continue in your terminal" : "Return to your terminal";
  const hint = approved ? "Your agent will finish connecting there."
    : "To try again, start a new authorization request with /auth.";
  const mark = approved ? '<path d="m8 12 3 3 5-6"/>' : '<path d="m9 9 6 6m0-6-6 6"/>';
  return {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${createHash("sha256").update(styles).digest("base64")}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Admin agent</title><style>${styles}</style></head><body><main class="${result}"><header>Admin agent access</header><div class="content"><div class="symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>${mark}</svg></div><h1>${title}</h1><p>${description}</p><div class="next"><strong>${next}</strong><span>${hint}</span></div></div><footer>${escapeHtml(origin)}</footer></main></body></html>`,
  };
}
