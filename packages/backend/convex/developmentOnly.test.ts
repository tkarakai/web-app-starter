import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import {
  EMAIL_DELIVERY_NOT_CONFIGURED,
  assertMockEmailAllowed,
  isLocalDevelopment,
} from "./developmentOnly";
import schema from "./schema";
import { appConfig } from "@web-app-starter/app-config";
import { sendAuthEmail } from "./sendAuthEmail";

const modules = import.meta.glob("./**/*.*s");
const recipient = "recipient@example.test";
const WEB_PORT = appConfig.runtime.ports.web;
const ADMIN_PORT = appConfig.runtime.ports.admin;

const LOCAL_SITE_URLS = [
  `http://localhost:${WEB_PORT}`,
  `http://localhost:${WEB_PORT},http://localhost:${ADMIN_PORT}`,
  `http://127.0.0.1:${WEB_PORT}`,
  `http://[::1]:${WEB_PORT}`,
  // The local AWS target (infra/aws/local) serves the apps on *.localhost.
  "http://web.app.localhost:8080,http://admin.app.localhost:8080",
  // A trailing comma is tolerated, as getSiteUrls() in auth.ts tolerates it.
  `http://localhost:${WEB_PORT},`,
];

const HOSTED_SITE_URLS = [
  "https://app.example.com",
  `https://localhost:${WEB_PORT}`,
  `http://192.168.1.2:${WEB_PORT}`,
  "http://localhost.example.com",
  `http://localhost:${WEB_PORT},https://app.example.com`,
  "not a url",
  "",
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isLocalDevelopment", () => {
  test.each(LOCAL_SITE_URLS)("SITE_URL %j is local", (siteUrl) => {
    vi.stubEnv("SITE_URL", siteUrl);
    expect(isLocalDevelopment()).toBe(true);
    expect(() => assertMockEmailAllowed()).not.toThrow();
  });

  test.each(HOSTED_SITE_URLS)("SITE_URL %j is not local", (siteUrl) => {
    vi.stubEnv("SITE_URL", siteUrl);
    expect(isLocalDevelopment()).toBe(false);
    expect(() => assertMockEmailAllowed()).toThrow(EMAIL_DELIVERY_NOT_CONFIGURED);
  });

  test("an unset SITE_URL is not local", () => {
    vi.stubEnv("SITE_URL", undefined);
    expect(isLocalDevelopment()).toBe(false);
  });
});

// The console fallback that stands in for email delivery when RESEND_API_KEY is
// unset, exercised through its real callers.
describe("mock email", () => {
  let logged: string[];

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", undefined);
    vi.stubEnv("ADMIN_SITE_URL", "https://admin.example.test");
    logged = [];
    vi.spyOn(console, "log").mockImplementation((message: string) => {
      logged.push(message);
    });
  });

  async function prepareSender(kind: "auth" | "admin" | "waitlist"): Promise<() => Promise<unknown>> {
    if (kind === "auth") {
      return () =>
        sendAuthEmail({ to: recipient, type: "magic-link", urlOrCode: "https://web.example.test/?token=secret" });
    }
    const t = convexTest(schema, modules);
    const now = Date.now();
    if (kind === "admin") {
      const adminInvitationId = await t.run((ctx) =>
        ctx.db.insert("adminInvitations", { email: recipient, status: "invited", invitedAt: now, createdAt: now }),
      );
      return () =>
        t.action(internal.adminInvitationActions.generateTokenAndSendEmail, { adminInvitationId, email: recipient });
    }
    const entryId = await t.run((ctx) =>
      ctx.db.insert("waitlistEntries", { email: recipient, status: "invited", meta: "{}", createdAt: now }),
    );
    return () => t.action(internal.waitlistActions.generateTokenAndSendEmail, { entryId, email: recipient });
  }

  for (const kind of ["auth", "admin", "waitlist"] as const) {
    test(`${kind} email refuses to fall back to the console outside local development`, async () => {
      vi.stubEnv("SITE_URL", "https://app.example.com");
      const send = await prepareSender(kind);

      await expect(send()).rejects.toThrow("EMAIL_DELIVERY_NOT_CONFIGURED");
      expect(logged.join("\n")).not.toContain(recipient);
    });

    test(`${kind} email falls back to the console in local development`, async () => {
      vi.stubEnv("SITE_URL", `http://localhost:${WEB_PORT}`);
      const send = await prepareSender(kind);

      await send();
      expect(logged.join("\n")).toContain(recipient);
    });
  }
});

describe("devSeed", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  test("refuses to run outside local development even with DEV_SEED_ENABLED=true", async () => {
    vi.stubEnv("DEV_SEED_ENABLED", "true");
    vi.stubEnv("SITE_URL", "https://app.example.com");
    const t = convexTest(schema, modules);

    await expect(t.action(internal.devSeed.seed, {})).rejects.toThrow("DEV_SEED_NOT_LOCAL");

    const created = await t.run(async (ctx) => ({
      adminEmails: await ctx.db.query("adminEmails").collect(),
      waitlistEntries: await ctx.db.query("waitlistEntries").collect(),
    }));
    expect(created).toEqual({ adminEmails: [], waitlistEntries: [] });
    expect(await t.query(internal.devSeed.isSeeded, {})).toBe(false);
  });

  test("refuses to run on a deployment without SITE_URL", async () => {
    vi.stubEnv("DEV_SEED_ENABLED", "true");
    vi.stubEnv("SITE_URL", undefined);
    const t = convexTest(schema, modules);

    await expect(t.action(internal.devSeed.seed, {})).rejects.toThrow("DEV_SEED_NOT_LOCAL");
  });

  test("still skips quietly when DEV_SEED_ENABLED is not set", async () => {
    vi.stubEnv("DEV_SEED_ENABLED", undefined);
    vi.stubEnv("SITE_URL", `http://localhost:${WEB_PORT}`);
    const t = convexTest(schema, modules);

    await expect(t.action(internal.devSeed.seed, {})).resolves.toBeNull();
    expect(await t.query(internal.devSeed.isSeeded, {})).toBe(false);
  });
});
