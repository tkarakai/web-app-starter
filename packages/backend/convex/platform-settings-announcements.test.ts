import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { localAppOrigin } from "@web-app-starter/app-config";
import { createTestEnv } from "./test.modules";
import { api, components, internal } from "./_generated/api";
import authSchema from "./platform/betterAuth/schema";

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./platform/betterAuth/**/*.*s"));
  async function signIn(name: string, role: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: { name, email: `${name}@example.test`, emailVerified: true, role, createdAt: now, updatedAt: now } },
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { userId: user._id, token: name, expiresAt: now + 3600_000, createdAt: now, updatedAt: now } },
    });
    return t.withIdentity({ subject: user._id, sessionId: session._id });
  }
  return { t, admin: await signIn("admin", "admin"), member: await signIn("member", "user") };
}

describe("settings and announcements wrappers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("admin settings persist in the component and reach public and auth-policy consumers", async () => {
    const { t, admin, member } = await fixture();
    const setting = { key: "userMagicLinkEnabled", value: "true" };
    await expect(member.mutation(api.platform.appSettings.set, setting)).rejects.toThrow("NOT_ADMIN");
    await admin.mutation(api.platform.appSettings.set, setting);
    expect(await t.query(api.platform.appSettings.getPublic, { key: setting.key })).toBe(true);
    expect(await member.query(api.platform.appSettings.get, { key: setting.key })).toBeNull();
    expect(await t.query(api.platform.appSettings.getPublic, { key: "invitationEmailTemplate" })).toBeNull();
    await admin.mutation(api.platform.adminAuth.setEmailVerificationPolicy, { required: false });
    expect(await admin.query(api.platform.adminAuth.getEmailVerificationPolicy, {})).toEqual({ emailVerificationRequired: false });
    expect(await t.query(internal.platform.appSettings.getInternal, { key: "userEmailVerificationRequired" })).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("appSettings").collect())).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const events = await t.query(components.platform.auditTrail.list, { paginationOpts: { numItems: 100, cursor: null } });
    expect(events.page.map((row) => row.action)).toContain("admin.user_magic_link_policy_changed");
    await admin.mutation(api.platform.appSettings.remove, { key: setting.key });
    expect(await t.query(api.platform.appSettings.getPublic, { key: setting.key })).toBe(false);
  });

  test("email defaults stay app-branded and custom templates round-trip through component storage", async () => {
    const { admin } = await fixture();
    expect(await admin.query(api.platform.appSettings.getEmailTemplate, {})).toMatchObject({ isCustom: false });
    const template = { subject: "Welcome", html: "<a href='{{invitation_link}}'>Join</a>", text: "Join {{invitation_link}}" };
    await admin.mutation(api.platform.appSettings.set, { key: "invitationEmailTemplate", value: JSON.stringify(template) });
    expect(await admin.query(api.platform.appSettings.getEmailTemplate, {})).toEqual({ ...template, isCustom: true });
  });

  test("announcement wrappers authorize admins, accept component IDs and render app URL variables", async () => {
    const { t, admin, member } = await fixture();
    const args = { name: "Release", bannerText: "New features", learnMoreName: "Details", learnMoreContent: "{{landingPageUrl}} / {{webAppUrl}}" };
    await expect(member.mutation(api.platform.announcements.create, args)).rejects.toThrow("NOT_ADMIN");
    const { id } = await admin.mutation(api.platform.announcements.create, args);
    expect(typeof id).toBe("string");
    expect(await member.query(api.platform.announcements.list, {})).toBeNull();
    await admin.mutation(api.platform.announcements.publishNow, { announcementId: id });
    const active = await t.query(api.platform.announcements.getActivePublic, {});
    expect(active?._id).toBe(id);
    expect(active?.learnMoreContent).toContain(localAppOrigin("landing"));
    expect(active?.learnMoreContent).toContain(localAppOrigin("web"));
    expect(await t.run((ctx) => ctx.db.query("announcements").collect())).toEqual([]);
    await admin.mutation(api.platform.announcements.archive, { announcementId: id });
    expect(await t.query(api.platform.announcements.getActivePublic, {})).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("seed sentinel is idempotent in component settings", async () => {
    const t = createTestEnv();
    expect(await t.query(internal.platform.devSeed.isSeeded, {})).toBe(false);
    await t.mutation(internal.platform.devSeed.markSeeded, {});
    await t.mutation(internal.platform.devSeed.markSeeded, {});
    expect(await t.query(internal.platform.devSeed.isSeeded, {})).toBe(true);
    expect((await t.query(components.platform.appSettings.getRaw, { key: "devSeedCompleted" }))?.value).toBe("true");
  });
});
