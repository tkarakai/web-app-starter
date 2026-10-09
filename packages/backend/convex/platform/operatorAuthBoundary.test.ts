import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getEndpoints } from "better-auth/api";
import { components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import { createAuth, createAuthOptions } from "./auth";
import authSchema from "./betterAuth/schema";

const authModules = import.meta.glob("./betterAuth/**/*.*s");
const origin = "http://localhost:3001";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("BETTER_AUTH_SECRET", "operator-privacy-auth-fixture-secret-at-least-32-characters");
  vi.stubEnv("SITE_URL", origin);
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);
  async function identity(name: string, role: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name, email: `${name}@example.test`, role, emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: user._id, token: `private-token:${name}`, createdAt: now, updatedAt: now, expiresAt: now + 60 * 60_000,
      assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
    } } });
    return { user, session };
  }
  const operator = await identity("operator", "admin");
  const customer = await identity("customer", "user");
  const request = (path: string, method: string, token?: string, body?: unknown) => t.fetch(`/api/auth${path}`, {
    method, headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { t, operator, customer, request };
}

describe("raw Better Auth app-operator boundary", () => {
  test("every installed generic admin endpoint denies HTTP for app operators, organization users and anonymous callers", async () => {
    const f = await fixture();
    const routes = await f.t.run(async ctx => Object.values(getEndpoints({} as never, createAuthOptions(ctx)).api)
      .filter(endpoint => endpoint.path?.startsWith("/admin/"))
      .map(endpoint => ({ path: endpoint.path!, method: Array.isArray(endpoint.options.method) ? endpoint.options.method[0] : endpoint.options.method ?? "POST" })));
    expect(routes.length).toBeGreaterThan(10);
    for (const token of [f.operator.session.token, f.customer.session.token, undefined]) {
      for (const endpoint of routes) {
        const method = endpoint.method;
        const response = await f.request(endpoint.path!, method, token, method === "GET" ? undefined : {
          userId: f.customer.user._id, role: "admin", password: "never-set-this", name: "never-create-this", email: "customer@example.test", sessionToken: f.customer.session.token,
        });
        expect(response.status, `${method} ${endpoint.path}: ${await response.clone().text()}`).toBe(403);
        const result = await response.text();
        expect(result).toContain("OPERATOR_API_REQUIRED");
        expect(result).not.toContain(f.customer.user._id);
        expect(result).not.toContain(f.customer.session.token);
      }
    }
    const customer = await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.customer.user._id }] });
    const session = await f.t.query(components.betterAuth.adapter.findOne, { model: "session", where: [{ field: "_id", value: f.customer.session._id }] });
    expect(customer).toEqual(f.customer.user);
    expect(session).toEqual(f.customer.session);
  });

  test("direct Better Auth API methods obey the same denial without the HTTP onRequest hook", async () => {
    const f = await fixture();
    const headers = new Headers({ origin, authorization: `Bearer ${f.operator.session.token}` });
    await expect(f.t.action(ctx => createAuth(ctx).api.setRole({ headers, body: { userId: f.customer.user._id, role: "admin" } }))).rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "OPERATOR_API_REQUIRED" } });
    await expect(f.t.action(ctx => createAuth(ctx).api.listUsers({ headers, query: {} }))).rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "OPERATOR_API_REQUIRED" } });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.customer.user._id }] })).toEqual(f.customer.user);
  });

  test("unrecognized/raw admin paths and malformed bodies cannot bypass the boundary", async () => {
    const f = await fixture();
    const response = await f.t.fetch("/api/auth/admin/set-role", {
      method: "POST", headers: { origin, authorization: `Bearer ${f.operator.session.token}`, "content-type": "application/json" }, body: "{broken-json",
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("OPERATOR_API_REQUIRED");
    const unknown = await f.request("/admin/future-generic-operation", "POST", f.operator.session.token, {});
    expect(unknown.status).toBe(403);
  });

  test("raw identity self-deletion remains unavailable until ownership and membership mappings are reviewed", async () => {
    const f = await fixture();
    const project = await f.t.run(ctx => ctx.db.insert("projects", {
      name: "Legacy operator-owned record", description: "Preserve", ownerId: f.operator.user._id, createdAt: Date.now(),
    }));
    for (const identity of [f.operator, f.customer]) {
      for (const [path, method] of [["/delete-user", "POST"], ["/delete-user/callback", "GET"]]) {
        const response = await f.request(path, method, identity.session.token, method === "POST" ? { password: "never-delete" } : undefined);
        expect(response.status).toBe(403);
        expect(await response.text()).toContain("IDENTITY_DELETION_REQUIRES_REVIEWED_MAPPING");
      }
      expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: identity.user._id }] })).toEqual(identity.user);
    }
    expect(await f.t.run(ctx => ctx.db.get(project))).toMatchObject({ ownerId: f.operator.user._id });
  });

  test("organization-user identity self-service still reads its session/passkeys and updates only its own profile", async () => {
    const f = await fixture();
    const key = await f.t.mutation(components.betterAuth.adapter.create, { input: { model: "passkey", data: {
      userId: f.customer.user._id, name: "My security key", publicKey: "private-key-material", credentialID: "customer-credential-id",
      counter: 0, deviceType: "singleDevice", backedUp: false,
    } } });
    const session = await f.request("/get-session", "GET", f.customer.session.token);
    expect(session.status, await session.clone().text()).toBe(200);
    expect((await session.json()).user.id).toBe(f.customer.user._id);
    const passkeys = await f.request("/passkey/list-user-passkeys", "GET", f.customer.session.token);
    expect(passkeys.status, await passkeys.clone().text()).toBe(200);
    expect((await passkeys.json()).map((row: { id: string }) => row.id)).toEqual([key._id]);
    // Registering a factor creates a stronger proof requirement for profile writes.
    await f.t.mutation(components.betterAuth.adapter.deleteOne, { input: { model: "passkey", where: [{ field: "_id", value: key._id }] } });
    const promotion = await f.request("/update-user", "POST", f.customer.session.token, { name: "Do not change", role: "admin", banned: false });
    expect(promotion.status).toBe(400);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.customer.user._id }] })).toEqual(f.customer.user);
    const update = await f.request("/update-user", "POST", f.customer.session.token, { name: "My updated name" });
    expect(update.status, await update.clone().text()).toBe(200);
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.customer.user._id }] })).toMatchObject({ name: "My updated name", role: "user" });
    expect(await f.t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: f.operator.user._id }] })).toEqual(f.operator.user);
  });
});
