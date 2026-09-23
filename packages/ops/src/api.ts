import { OpsError, registerSecret, redact } from "./errors";
import type { Api } from "./types";

export type Fetcher = (input: string | URL | Request, init?: Parameters<typeof fetch>[1]) => Promise<Response>;
export class HttpApi implements Api {
  constructor(private provider: "github" | "vercel", private token: string,
    private log: (message: string) => void = () => {}, private fetcher: Fetcher = fetch,
    private sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  ) { registerSecret(token); }
  get<T>(path: string) { return this.request<T>(path); }
  post<T>(path: string, body: unknown) { return this.request<T>(path, body); }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const origin = this.provider === "github" ? "https://api.github.com" : "https://api.vercel.com";
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new OpsError("INVALID_URL", "Refusing to send credentials to an unexpected host.", "Check the API path.");
    const method = body === undefined ? "GET" : "POST";
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now();
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method, redirect: "error", signal: globalThis.AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", "Content-Type": "application/json",
            ...(this.provider === "github" ? { "X-GitHub-Api-Version": "2022-11-28" } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (cause) {
        if (cause instanceof OpsError) throw cause;
        if (method === "GET" && attempt < 2) {
          this.log(`${this.provider} ${method} ${url.pathname}: ${redact(String(cause))}; retry ${attempt + 1}/2`);
          await this.sleep(500 * 2 ** attempt); continue;
        }
        throw new OpsError(method === "POST" ? "WRITE_OUTCOME_UNKNOWN" : "NETWORK", `${this.provider} ${method} ${url.pathname} failed: ${redact(String(cause))}`,
          method === "POST" ? "The request may have been accepted. Check ops runs before retrying; writes are never retried automatically." : "Check connectivity and retry. No empty result has been substituted.", 1,
          { provider: this.provider, method, path: url.pathname }, { cause });
      }
      this.log(`${this.provider} ${method} ${url.pathname}: HTTP ${response.status} (${Date.now() - started}ms)`);
      if (!response.ok) {
        const raw = await response.text();
        let message = response.statusText;
        try { const data = JSON.parse(raw); message = data.message ?? data.error?.message ?? message; }
        catch { message = `${message} (non-JSON error response)`; }
        const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")));
        const retry = Number(response.headers.get("retry-after") ?? 0);
        if (method === "GET" && attempt < 2 && (rateLimited || response.status >= 500) && retry <= 10) {
          this.log(`${this.provider}: ${redact(message)}; retry ${attempt + 1}/2`);
          await this.sleep(Math.max(retry * 1000, 500 * 2 ** attempt)); continue;
        }
        throw new OpsError(method === "POST" && response.status >= 500 ? "WRITE_OUTCOME_UNKNOWN" : rateLimited ? "RATE_LIMIT" : response.status === 401 ? "AUTH" : response.status === 403 ? "FORBIDDEN" : response.status === 404 ? "NOT_FOUND" : "API_ERROR",
          `${this.provider} ${method} ${url.pathname}: HTTP ${response.status}: ${redact(message)}`,
          rateLimited ? "Wait for the provider rate limit to reset, then retry." : response.status === 401 || response.status === 403 ? `Check ${this.provider === "github" ? "gh auth status / GH_TOKEN and repository permissions" : "ops auth status; run ops auth login vercel to renew the CLI session, or check VERCEL_TOKEN and team access if set"}.` : response.status === 404 ? "Check the resource ID and account access; private resources may return 404." : "Check the provider status and linked workflow. Writes are not automatically retried.",
          1, { provider: this.provider, status: response.status, path: url.pathname, requestId: response.headers.get("x-github-request-id") ?? response.headers.get("x-vercel-id"), retryAfter: response.headers.get("retry-after"), resetAt: response.headers.get("x-ratelimit-reset") });
      }
      if (response.status === 204) return undefined as T;
      try { return await response.json() as T; }
      catch (cause) { throw new OpsError("INVALID_RESPONSE", `${this.provider} returned invalid JSON for ${url.pathname}.`, "Retry and check the provider status.", 1, {}, { cause }); }
    }
    throw new Error("Unreachable retry state");
  }
  async pages<T>(path: string, key?: string, limit = 1000): Promise<T[]> {
    const result: T[] = [];
    let cursor: number | undefined;
    for (let page = 1; result.length < limit; page++) {
      const url = new URL(path, "https://unused.invalid");
      if (this.provider === "github") { url.searchParams.set("per_page", String(Math.min(100, limit))); url.searchParams.set("page", String(page)); }
      else { url.searchParams.set("limit", String(Math.min(100, limit))); if (cursor !== undefined) url.searchParams.set("until", String(cursor)); }
      const data = await this.get<unknown>(url.pathname + url.search);
      const entries = key ? (data as Record<string, unknown>)?.[key] : data;
      if (!Array.isArray(entries)) throw new OpsError("INVALID_RESPONSE", `${this.provider} response is missing the ${key ?? "array"} collection.`, "Run with --debug and report the provider response shape.");
      result.push(...entries as T[]);
      if (this.provider === "vercel") {
        const next = (data as { pagination?: { next?: number | null } }).pagination?.next;
        if (next == null) break;
        if (next === cursor) throw new OpsError("PAGINATION", "Vercel returned a repeated pagination cursor.", "Retry later; results were not silently truncated.");
        cursor = next;
      } else if (entries.length < Number(url.searchParams.get("per_page"))) break;
    }
    return result.slice(0, limit);
  }
}
