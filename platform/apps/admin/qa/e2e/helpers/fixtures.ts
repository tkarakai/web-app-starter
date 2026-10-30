/**
 * Disposable user fixtures for E2E tests.
 *
 * Every mutating auth spec used to share the single dev-seed account, so a test
 * that failed part-way through left it on a changed password or with 2FA
 * enabled — breaking every later spec, and local development with it. These
 * helpers hand each test its own throwaway account instead.
 *
 * Backed by `POST /api/dev/e2e-user` on the Convex HTTP router, which is gated
 * on the local runtime and a generated harness secret, with reserved fixture addresses.
 * See `packages/backend/convex/platform/e2eFixtures.ts` for the safety rationale.
 *
 * @module qa/e2e/helpers/fixtures
 */

import { randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DisposableUser {
  email: string;
  password: string;
  name: string;
}

/**
 * Prefer the process environment, then the launcher-owned capability file,
 * then app/root .env.local. Keep the capability paired with its backend URL.
 */
function getEnvValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];

  for (const envPath of [
    process.env.DEV_FIXTURE_SECRET_FILE ?? path.join(__dirname, "../../../../../../.env.e2e.local"),
    path.join(__dirname, "../../../.env.local"),
    path.join(__dirname, "../../../../../../.env.local"),
  ]) {
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^${name}=(.*)`, "m"));
      if (match) {
        const value = match[1].trim();
        if (value) return value;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

function convexSiteUrl(): string {
  const url = getEnvValue("CONVEX_SITE_URL");
  if (!url) {
    throw new Error(
      "CONVEX_SITE_URL is not set. E2E fixtures call the Convex HTTP " +
        "router directly; run `bun run dev` (or dev-start.sh) so the URL is written " +
        "to .env.local.",
    );
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" ||
      !(["localhost", "127.0.0.1", "[::1]", "convex.localhost.floci.io"].includes(parsed.hostname) || parsed.hostname.endsWith(".localhost"))) {
    throw new Error("Fixture helpers only send their capability to a local backend.");
  }
  return parsed.origin;
}

/**
 * A fixture address in the reserved `.local` TLD, which cannot receive mail and
 * so can never collide with a real account. The backend rejects anything else.
 */
export function disposableEmail(): string {
  return `e2e-${randomUUID().slice(0, 18)}@e2e.local`;
}

/**
 * A password with enough entropy to clear zxcvbn — the app scores credentials,
 * not just their length, and rejects anything derived from the email. Also
 * exceed the administrator's 40-character minimum.
 */
export function disposablePassword(): string {
  return `Qx7!${randomBytes(32).toString("base64url")}#2z`;
}

/**
 * Create a fresh, email-verified account and return its credentials.
 *
 * The account is admitted past `inviteOnly` gating by the backend, which mints
 * the invitation rows first — tests cannot self-register otherwise.
 */
export async function createDisposableUser(
  options: { isAdmin?: boolean } = {},
): Promise<DisposableUser> {
  const user: DisposableUser = {
    email: disposableEmail(),
    password: disposablePassword(),
    name: "E2E User",
  };

  const secret = getEnvValue("DEV_FIXTURE_SECRET");
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("Local fixture secret is missing. Restart bun run dev, or set DEV_FIXTURE_SECRET_FILE to the local AWS fixture.env file.");

  const response = await fetch(`${convexSiteUrl()}/api/dev/e2e-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dev-Fixture-Secret": secret },
    redirect: "error",
    body: JSON.stringify({ ...user, isAdmin: options.isAdmin === true }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404) {
      throw new Error(
        "E2E fixture endpoint is disabled (404). Restart the local dev launcher " +
          "to provision its runtime authorization and harness secret. " +
          `Response: ${detail}`,
      );
    }
    throw new Error(
      `Could not create a disposable user (HTTP ${response.status}): ${detail}`,
    );
  }

  return user;
}

/** A browser test may use real authenticated Convex APIs only on its disposable local backend. */
export function localConvexUrl(): string {
  const value = getEnvValue("CONVEX_URL");
  if (!value) throw new Error("CONVEX_URL is required for local organization acceptance.");
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" ||
    !(["localhost", "127.0.0.1", "[::1]", "convex.localhost.floci.io"].includes(parsed.hostname) || parsed.hostname.endsWith(".localhost"))) {
    throw new Error("Organization acceptance only targets a disposable local backend.");
  }
  return parsed.origin;
}
