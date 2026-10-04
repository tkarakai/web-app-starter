import { getEndpoints } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import { createAuthOptions } from "./auth";
import { convexRateLimitPlugin, isAuthRequestLimited, trustedAuthIp } from "./authRateLimits";
import authSchema from "./betterAuth/schema";
import { sendAuthEmail } from "./sendAuthEmail";
import { AUTH_COOKIE_PREFIX } from "@web-app-starter/auth/cookies";
import { createHmac } from "node:crypto";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const authModules = import.meta.glob("./betterAuth/**/*.*s");
const magicPath = "/api/auth/sign-in/magic-link";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.mocked(sendAuthEmail).mockReset().mockResolvedValue(undefined);
  vi.stubEnv("BETTER_AUTH_SECRET", "auth-rate-fixture-secret-at-least-32-characters");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubEnv("AUTH_TRUSTED_IP_HEADER", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);
  await t.mutation(components.platform.appSettings.putRaw, { key: "userMagicLinkEnabled", value: "true" });
  const post = (path: string, body: unknown, ip = "192.0.2.1") => t.fetch(path, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body),
  });
  return { t, post };
}

async function otpUser(f: Awaited<ReturnType<typeof fixture>>, email: string, twoFactorEnabled = false) {
  const now = Date.now();
  return f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
    name: "OTP", email, emailVerified: true, twoFactorEnabled, createdAt: now, updatedAt: now,
  } } });
}

function signedCookie(name: string, value: string) {
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(value).digest("base64");
  return `${AUTH_COOKIE_PREFIX}.${name}=${encodeURIComponent(`${value}.${signature}`)}`;
}

async function twoFactorFixture(pending: boolean) {
  const f = await fixture();
  const user = await otpUser(f, "two-factor@example.test", true);
  await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: {
    userId: user._id, secret: "unused", backupCodes: "unused", verified: true,
  } } });
  const now = Date.now();
  let cookie: string;
  if (pending) {
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "verification", data: {
      identifier: "pending-two-factor", value: user._id, expiresAt: now + 300000, createdAt: now, updatedAt: now,
    } } });
    cookie = signedCookie("two_factor", "pending-two-factor");
  } else {
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      token: "otp-session", userId: user._id, expiresAt: now + 300000, createdAt: now, updatedAt: now,
    } } });
    cookie = signedCookie("session_token", "otp-session");
  }
  const post = (path: string, body: unknown) => f.t.fetch(`/api/auth/two-factor/${path}`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body),
  });
  return { ...f, post };
}

describe("auth email delivery budgets", () => {
  test("bearer password sign-in and two-factor enrollment deliver bounded usable OTPs", async () => {
    const f = await fixture();
    const email = "bearer-otp@example.test";
    const password = "violet compass timber waterfall oyster constellation";
    const user = await otpUser(f, email);
    const now = Date.now();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
      userId: user._id, accountId: user._id, providerId: "credential",
      password: await hashPassword(password), createdAt: now, updatedAt: now,
    } } });
    const signedIn = await f.post("/api/auth/sign-in/email", { email, password });
    expect(signedIn.status).toBe(200);
    const { token } = await signedIn.json();
    expect(token).toEqual(expect.any(String));
    const post = (path: string, body: unknown) => f.t.fetch(`/api/auth/two-factor/${path}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    expect((await post("enable", { password })).status).toBe(200);
    const replies = await Promise.all(Array.from({ length: 6 }, () => post("send-otp", {})));
    expect(replies.filter(r => r.status === 200)).toHaveLength(3);
    expect(replies.filter(r => r.status === 429)).toHaveLength(3);
    for (const response of replies.filter(r => r.status === 429)) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const codes = vi.mocked(sendAuthEmail).mock.calls.map(([message]) => message.urlOrCode);
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect((await post("verify-otp", { code: codes[0] })).status).toBe(200);
  });

  test.each([false, true])("two-factor resends preserve delivered codes and return bounded exhaustion errors (pending=%s)", async pending => {
    const f = await twoFactorFixture(pending);
    const replies = await Promise.all(Array.from({ length: 6 }, () => f.post("send-otp", {})));
    expect(replies.filter(r => r.status === 200)).toHaveLength(3);
    expect(replies.filter(r => r.status === 429)).toHaveLength(3);
    for (const response of replies.filter(r => r.status === 429)) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const codes = vi.mocked(sendAuthEmail).mock.calls.map(([message]) => message.urlOrCode);
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect((await f.post("verify-otp", { code: codes[0] })).status).toBe(200);
  });

  test.each(["recipient", "global", "daily"])("email OTP concurrent reset aliases preserve a delivered code under %s exhaustion", async budget => {
    const f = await fixture();
    await otpUser(f, "race@example.test");
    if (budget !== "recipient") await f.t.run(ctx => ctx.db.insert("rateLimits", {
      name: budget === "global" ? "authEmailGlobal" : "authEmailDaily", value: 2, ts: Date.now(),
    }));
    const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => f.post(
      i % 2 ? "/api/auth/email-otp/request-password-reset" : "/api/auth/email-otp/send-verification-otp",
      { email: "race@example.test", type: "forget-password" },
    )));
    const codes = vi.mocked(sendAuthEmail).mock.calls.map(([message]) => message.urlOrCode);
    expect(codes).toHaveLength(budget === "recipient" ? 3 : 2);
    expect(new Set(codes).size).toBe(1);
    expect(replies.filter(r => r.status === 429)).toHaveLength(budget === "recipient" ? 3 : 4);
    expect((await f.post("/api/auth/email-otp/check-verification-otp", {
      email: "race@example.test", type: "forget-password", otp: codes[0],
    })).status).toBe(200);
  });
  test("the installed magic-link route stops before delivery at its three-message burst", async () => {
    const f = await fixture();
    const replies = [];
    for (let i = 0; i < 6; i++) replies.push(await f.post(magicPath, { email: "recipient@example.test" }));
    expect(replies.map(r => r.status)).toEqual([200, 200, 200, 429, 429, 429]);
    expect(vi.mocked(sendAuthEmail).mock.calls).toHaveLength(3);
    expect(Number(replies[3].headers.get("retry-after"))).toBeGreaterThan(0);
  });
  test("recipient casing and arbitrary forwarded IP rotation cannot bypass delivery limits", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) expect((await f.post(magicPath, { email: "Recipient@Example.Test" }, `192.0.2.${i + 1}`)).status).toBe(200);
    expect((await f.post(magicPath, { email: "recipient@example.test" }, "198.51.100.9")).status).toBe(429);
    expect(vi.mocked(sendAuthEmail).mock.calls.map(([message]) => message.to)).toEqual(Array(3).fill("recipient@example.test"));
  });
  test("all email-producing callbacks share one actual-recipient budget", async () => {
    const f = await fixture();
    const now = Date.now();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "Recipient", email: "recipient@example.test", emailVerified: false, createdAt: now, updatedAt: now,
    } } });
    expect((await f.post(magicPath, { email: "recipient@example.test" })).status).toBe(200);
    expect((await f.post("/api/auth/request-password-reset", { email: "recipient@example.test" })).status).toBe(200);
    expect((await f.post("/api/auth/email-otp/request-password-reset", { email: "recipient@example.test" })).status).toBe(200);
    expect((await f.post("/api/auth/send-verification-email", { email: "recipient@example.test" })).status).toBe(429);
    expect(vi.mocked(sendAuthEmail).mock.calls).toHaveLength(3);
  });
  test("concurrent recipient requests cannot overbook the three-message budget", async () => {
    const f = await fixture();
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => f.post(magicPath, { email: "parallel@example.test" }, `192.0.2.${i + 1}`)));
    expect(responses.filter(r => r.status === 200)).toHaveLength(3);
    expect(responses.filter(r => r.status === 429)).toHaveLength(5);
    expect(vi.mocked(sendAuthEmail).mock.calls).toHaveLength(3);
  });
  test("deployment burst budget stops recipient/IP rotation and limits exhaustion logging", async () => {
    const f = await fixture();
    for (let i = 0; i < 24; i++) {
      expect((await f.post(magicPath, { email: `recipient-${i}@example.test` }, `192.0.2.${i + 1}`)).status).toBe(i < 20 ? 200 : 429);
    }
    expect(vi.mocked(sendAuthEmail).mock.calls).toHaveLength(20);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("AUTH_EMAIL_BUDGET_EXHAUSTED", { budget: "authEmailGlobal" });
  });
  test("daily budget is independent of a replenished minute budget", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.insert("rateLimits", { name: "authEmailDaily", value: 0, ts: Date.now() }));
    expect((await f.post(magicPath, { email: "daily@example.test" })).status).toBe(429);
    expect(sendAuthEmail).not.toHaveBeenCalled();
  });
  test("concurrent distinct recipients cannot overbook the deployment delivery budget", async () => {
    const f = await fixture();
    const responses = await Promise.all(Array.from({ length: 24 }, (_, i) =>
      f.post(magicPath, { email: `parallel-${i}@example.test` }, `192.0.2.${i + 1}`)));
    expect(responses.filter(r => r.status === 200)).toHaveLength(20);
    expect(responses.filter(r => r.status === 429)).toHaveLength(4);
    expect(sendAuthEmail).toHaveBeenCalledTimes(20);
  });
  test("a rejected reservation does not consume another delivery bucket", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.insert("rateLimits", { name: "authEmailDaily", value: 0, ts: Date.now() }));
    expect(await f.t.mutation(internal.platform.rateLimits.reserveAuthEmail, { recipientKey: "fixture" })).toMatchObject({ ok: false });
    const limits = await f.t.run(ctx => ctx.db.query("rateLimits").collect());
    expect(limits.some(limit => limit.name === "authEmailRecipient")).toBe(false);
    expect(limits.some(limit => limit.name === "authEmailGlobal")).toBe(false);
  });
  test("sender errors consume attempts and repeated retries remain bounded", async () => {
    const f = await fixture();
    vi.mocked(sendAuthEmail).mockRejectedValue(new Error("Simulated provider failure"));
    for (let i = 0; i < 6; i++) {
      const response = await f.post(magicPath, { email: "failure@example.test" });
      expect(response.status).toBe(i < 3 ? 500 : 429);
    }
    expect(vi.mocked(sendAuthEmail).mock.calls).toHaveLength(3);
  });
  test("rejections do not push the retry time forward; refill permits a later delivery", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await f.post(magicPath, { email: "retry@example.test" });
    for (let i = 0; i < 3; i++) expect((await f.post(magicPath, { email: "retry@example.test" })).status).toBe(429);
    vi.setSystemTime(Date.now() + 20001);
    expect((await f.post(magicPath, { email: "retry@example.test" })).status).toBe(200);
    expect(vi.mocked(sendAuthEmail).mock.calls).toHaveLength(4);
  });
  test("OTP resend reuses the unexpired code rather than replacing a delivered proof", async () => {
    const f = await fixture();
    const now = Date.now();
    await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name: "OTP", email: "otp@example.test", emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    for (let i = 0; i < 2; i++) expect((await f.post("/api/auth/email-otp/request-password-reset", { email: "otp@example.test" })).status).toBe(200);
    const [first, second] = vi.mocked(sendAuthEmail).mock.calls.map(([message]) => message.urlOrCode);
    expect(first).toMatch(/^\d{6}$/);
    expect(second).toBe(first);
  });
});

describe("auth route and ingress coverage", () => {
  test("form and JSON password sign-in share the normalized recipient budget", async () => {
    const f = await fixture();
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const response = i % 2 ? await f.post("/api/auth/sign-in/email", { email: "form@example.test", password: "wrong" })
        : await f.t.fetch("/api/auth/sign-in/email", {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: process.env.SITE_URL! },
          body: new URLSearchParams({ email: "Form@Example.Test", password: "wrong" }).toString(),
        });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });
  test("every installed HTTP endpoint is either explicitly read-only or persistently limited", async () => {
    const options = createAuthOptions({} as never);
    const routes = Object.values(getEndpoints({} as never, options).api)
      .filter(endpoint => typeof endpoint.path === "string");
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.map(r => r.path)).toContain("/sign-in/magic-link");
    const ctx = { runQuery: vi.fn(), runAction: vi.fn(), runMutation: vi.fn().mockResolvedValue({ ok: false, retryAt: Date.now() + 1000 }) };
    const plugin = convexRateLimitPlugin(ctx as never);
    for (const endpoint of routes) {
      const methods = Array.isArray(endpoint.options.method) ? endpoint.options.method : [endpoint.options.method ?? "POST"];
      for (const method of methods) {
        const limited = isAuthRequestLimited(endpoint.path!, method);
        ctx.runMutation.mockClear();
        const result = await plugin.onRequest!(new Request(`http://localhost/api/auth${endpoint.path}`, { method,
          ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "coverage@example.test" }) }),
        }), {} as never);
        expect(ctx.runMutation.mock.calls.length, `${method} ${endpoint.path}`).toBe(limited ? 1 : 0);
        if (limited) expect(result && "response" in result ? result.response?.status : undefined).toBe(429);
      }
    }
  });
  test("unknown routes have a deployment budget even with no trusted client IP", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.insert("rateLimits", { name: "authRequestGlobal", value: 0, ts: Date.now() }));
    expect(await f.t.mutation(internal.platform.rateLimits.consumeAuthRequestBudget, { path: "/new-plugin-route" })).toMatchObject({ ok: false });
  });
  test("claimed forwarded headers are ignored unless the operator configured a verified header", () => {
    const req = (value: string) => new Request("http://localhost", { headers: { "x-forwarded-for": value } });
    expect(trustedAuthIp(req("192.0.2.1"))).toBeUndefined();
    vi.stubEnv("AUTH_TRUSTED_IP_HEADER", "x-forwarded-for");
    expect(trustedAuthIp(req("192.0.2.1"))).toBe("192.0.2.1");
    expect(trustedAuthIp(req("attacker, 192.0.2.1"))).toBeUndefined();
    expect(trustedAuthIp(req("2001:0DB8:0:0:0:0:0:1"))).toBe("[2001:db8::1]");
  });
  test("a configured ingress IP bucket limits requests independently of recipient rotation", async () => {
    const f = await fixture();
    for (let i = 0; i < 50; i++) expect(await f.t.mutation(internal.platform.rateLimits.consumeAuthRequestBudget, {
      path: "/sign-in/email", recipientKey: `recipient-${i}`, ipKey: "verified-ip",
    })).toMatchObject({ ok: true });
    expect(await f.t.mutation(internal.platform.rateLimits.consumeAuthRequestBudget, {
      path: "/sign-in/email", recipientKey: "new-recipient", ipKey: "verified-ip",
    })).toMatchObject({ ok: false });
  });
});
