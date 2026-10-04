/** Local fixture authorization. Read inside handlers, never during module analysis.
 * Canonical backend URLs are an additional check, not immutable deployment identity:
 * an operator can override them. The local launcher provisions a random capability;
 * hosted deployment preflight rejects every fixture setting.
 */
import { isLocalDevelopment } from "./developmentOnly";

export const FIXTURE_HEADER = "X-Dev-Fixture-Secret";
const SECRET_PATTERN = /^[a-f0-9]{64}$/;

export function isLocalBackendOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return false;
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost")) return true;
    // Only the dedicated local Docker target uses Floci's split DNS hostname.
    return process.env.DEV_FIXTURE_RUNTIME === "local-aws" && url.hostname === "convex.localhost.floci.io";
  } catch { return false; }
}

export function localFixturesEnabled(): boolean {
  return process.env.DEV_SEED_ENABLED === "true" &&
    ["anonymous", "local-aws"].includes(process.env.DEV_FIXTURE_RUNTIME ?? "") &&
    SECRET_PATTERN.test(process.env.DEV_FIXTURE_SECRET ?? "") &&
    isLocalDevelopment() &&
    isLocalBackendOrigin(process.env.CONVEX_CLOUD_URL) &&
    isLocalBackendOrigin(process.env.CONVEX_SITE_URL);
}

export function assertLocalFixtures(): void {
  if (!localFixturesEnabled()) throw new Error("DEV_SEED_NOT_LOCAL: local fixture authorization is missing or this deployment is not local. Restart the local dev launcher.");
}

export function authorizeFixtureRequest(request: Request): boolean {
  if (!localFixturesEnabled()) return false;
  // Never accept a credential through a URL, cookie, body or browser CORS flow.
  const supplied = request.headers.get(FIXTURE_HEADER) ?? "";
  const expected = process.env.DEV_FIXTURE_SECRET!;
  if (!SECRET_PATTERN.test(supplied)) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}
