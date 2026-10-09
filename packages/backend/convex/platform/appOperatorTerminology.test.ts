import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import authSchema from "./betterAuth/schema";
import { appOperatorQuery, appOperatorMutation, adminQuery, adminMutation } from "./functions";
import { requireAppOperator, requireAppOperatorTarget } from "./appOperatorAccess";
import { requireOperator, requireOperatorTarget } from "./operatorAccess";
import { appOperatorIdentity } from "./appOperatorIdentity";
import { operatorIdentity } from "./operatorIdentity";
import { APP_OPERATOR_AUDIT_SOURCE, LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS } from "./appOperatorAuditCompatibility";
import { OPERATOR_AUDIT_SOURCE } from "./auditPrivacy";
import { classifyNative, invokeNative, nativeOperation } from "./nativeCapabilities";
import { catalogueRows } from "./agentRegistry";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const authModules = import.meta.glob("./betterAuth/**/*.*s");
async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, authModules);
  async function identity(name: string, role: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: {
      name, role, email: `${name}@example.test`, emailVerified: true, createdAt: now, updatedAt: now,
    } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId: user._id, token: `${name}-private-token`, createdAt: now, updatedAt: now, expiresAt: now + 3600_000,
      assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
    } } });
    return { user, session, client: t.withIdentity({ subject: user._id, sessionId: session._id }) };
  }
  return { t, appOperator: await identity("app-operator", "admin"), orgUser: await identity("org-user", "user") };
}

describe("app-operator names and deprecated compatibility interfaces", () => {
  test("canonical/deprecated builders preserve authorization, state and recent-proof behavior", async () => {
    const f = await fixture();
    expect(adminQuery).toBe(appOperatorQuery);
    expect(adminMutation).toBe(appOperatorMutation);
    for (const [queryBuilder, mutationBuilder] of [[appOperatorQuery, appOperatorMutation], [adminQuery, adminMutation]]) {
      const read = queryBuilder({ args: {}, handler: async ctx => ({ userId: ctx.user._id }) });
      const write = mutationBuilder({ args: { value: v.string() }, handler: async (ctx, args) => {
        await ctx.runMutation(components.platform.appSettings.putRaw, { key: "appOperatorNamingFixture", value: args.value });
      } });
      expect(await f.appOperator.client.query(ctx => read._handler(ctx, {}))).toEqual({ userId: f.appOperator.user._id });
      await f.appOperator.client.mutation(ctx => write._handler(ctx, { value: "preserved" }));
      await expect(f.orgUser.client.mutation(ctx => write._handler(ctx, { value: "forbidden" }))).rejects.toThrow("NOT_ADMIN");
      expect(await f.t.query(components.platform.appSettings.getRaw, { key: "appOperatorNamingFixture" })).toMatchObject({ value: "preserved" });
      const now = Date.now();
      vi.setSystemTime(now + 5 * 60_000 + 1);
      await expect(f.appOperator.client.mutation(ctx => write._handler(ctx, { value: "stale" }))).rejects.toThrow("RECENT_AUTHENTICATION_REQUIRED");
      expect(await f.appOperator.client.query(ctx => read._handler(ctx, {}))).toEqual({ userId: f.appOperator.user._id });
      vi.setSystemTime(now);
    }
  });

  test("deprecated guard imports resolve the same actor/targets and reject organization users", async () => {
    const f = await fixture();
    expect(requireOperator).toBe(requireAppOperator);
    expect(requireOperatorTarget).toBe(requireAppOperatorTarget);
    expect(operatorIdentity).toBe(appOperatorIdentity);
    const canonical = await f.appOperator.client.query(ctx => requireAppOperator(ctx));
    expect(await f.appOperator.client.query(ctx => requireOperator(ctx))).toEqual(canonical);
    for (const guard of [requireAppOperator, requireOperator]) await expect(f.orgUser.client.query(ctx => guard(ctx))).rejects.toThrow("NOT_ADMIN");
    for (const target of [requireAppOperatorTarget, requireOperatorTarget]) {
      expect(await f.t.query(ctx => target(ctx, f.appOperator.user._id))).toEqual(f.appOperator.user);
      await expect(f.t.query(ctx => target(ctx, f.orgUser.user._id))).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    }
  });

  test("shared native capture retains one classified operation and the same guarded handler", async () => {
    const f = await fixture();
    const registered = appOperatorQuery({ args: { userId: v.string() }, handler: async (ctx, args) => {
      await requireAppOperator(ctx);
      return { id: (await requireAppOperatorTarget(ctx, args.userId))._id };
    } });
    const deprecatedAlias = registered;
    classifyNative(registered, "platform/agentUsers:get");
    classifyNative(deprecatedAlias, "platform/agentUsers:get");
    expect(nativeOperation(deprecatedAlias)).toBe("platform/agentUsers:get");
    expect(await f.appOperator.client.run(async ctx => invokeNative(deprecatedAlias, ctx, await requireAppOperator(ctx), { userId: f.appOperator.user._id }))).toEqual({ id: f.appOperator.user._id });
    await expect(f.appOperator.client.run(async ctx => invokeNative(registered, ctx, await requireAppOperator(ctx), { userId: f.orgUser.user._id }))).rejects.toThrow("OPERATOR_TARGET_REQUIRED");
    expect(catalogueRows().find(row => row.name === "users_list")?.title).toBe("App operators: list");
  });

  test("historic audit source/sourceDetail wire values and records remain unchanged", async () => {
    const f = await fixture();
    expect(OPERATOR_AUDIT_SOURCE).toBe(APP_OPERATOR_AUDIT_SOURCE);
    await f.t.mutation(internal.platform.auditTrail.insertEvent, {
      actor: f.appOperator.user.email, authenticatedUserId: f.appOperator.user._id,
      sourceDetail: LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.identityAdministration,
      action: "admin.user.unbanned", resource: `user:${f.appOperator.user._id}`, status: "succeeded",
    });
    const legacyId = await f.t.mutation(components.platform.auditTrail.insertEvent, {
      actor: f.orgUser.user.email, source: "server:admin-mutation", action: "auth.sign_in", resource: "historic-private",
      status: "succeeded", meta: '{"historic":"private-evidence"}',
    });
    const rows = await f.t.query(components.platform.auditTrail.list, { paginationOpts: { numItems: 100, cursor: null } });
    expect(rows.page.find(row => row.authenticatedUserId === f.appOperator.user._id)?.source).toBe("server:operator-audit:v1");
    expect(LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.identityAdministration).toBe("agent-users");
    expect(LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS.enrollment).toBe("admin-enrollment");
    expect(rows.page.find(row => row._id === legacyId)).toMatchObject({ source: "server:admin-mutation", meta: '{"historic":"private-evidence"}' });
  });
});
