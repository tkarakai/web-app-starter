import { MEMBERSHIP_MANAGEMENT_EXPERIENCE, ORG_ADMIN_MEMBERSHIP_ROLE, ORG_MEMBER_ROLE } from "./betterAuth/organizationVocabulary";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "../_generated/api";
import { createTestEnv } from "../test.modules";
import schema from "./betterAuth/schema";
import { sha256Hex } from "./tokenHash";
import { sendAuthEmail } from "./sendAuthEmail";
import { catalogueRows } from "./agentRegistry";

vi.mock("./sendAuthEmail", () => ({ sendAuthEmail: vi.fn() }));
const password = "orchid quartz lantern telescope meadow violin glacier";
// HIBP range-response suffix for the fixed password above, independently computed with shasum.
const breachedPasswordResponse = "0669B906969E3D26AA2743D5EFE5A422263:1";
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
  vi.stubEnv("BETTER_AUTH_SECRET", "member-invitation-fixture-secret-at-least-32-characters");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("")));
  vi.mocked(sendAuthEmail).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const invites = components.betterAuth.memberInvitations;

async function fixture() {
  const t = createTestEnv();
  t.registerComponent("betterAuth", schema, import.meta.glob("./betterAuth/**/*.*s"));
  async function user(email = `${randomUUID()}@example.test`, role = "user", verified = true) {
    const now = Date.now();
    const result = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: "Member fixture", email, role, emailVerified: verified, createdAt: now, updatedAt: now } } });
    await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: { userId: result._id, accountId: result._id, providerId: "credential", password: passwordHash, createdAt: now, updatedAt: now } } });
    return result;
  }
  async function client(userId: string, purpose = "application") {
    const now = Date.now();
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: {
      userId, token: randomUUID(), authPurpose: purpose, assuranceVersion: 1, authMethod: "password", primaryVerifiedAt: now, authenticatedAt: now,
      createdAt: now, updatedAt: now, expiresAt: now + 7 * 86_400_000,
    } } });
    return t.withIdentity({ subject: userId, sessionId: session._id });
  }
  async function organization() {
    const admin = await user();
    const org = await t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: admin._id });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: admin._id }], update: { twoFactorEnabled: true } } });
    const factor = await t.mutation(components.betterAuth.adapter.create, { input: { model: "twoFactor", data: { userId: admin._id, verified: true, secret: "fixture-factor", backupCodes: "fixture-codes" } } });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "member", where: [{ field: "_id", value: org.memberId }], update: { adminEnrolledAt: Date.now(), adminFactorId: factor._id } } });
    await t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: org.organizationId }], update: { experience: MEMBERSHIP_MANAGEMENT_EXPERIENCE } } });
    return { ...org, admin };
  }
  const org = await organization();
  async function invite(email = `${randomUUID()}@example.test`, role: typeof ORG_MEMBER_ROLE | typeof ORG_ADMIN_MEMBERSHIP_ROLE = ORG_MEMBER_ROLE, target = org) {
    const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const id = await t.mutation(invites.issue, { organizationId: target.organizationId, actorId: target.admin._id, email, role, tokenHash: sha256Hex(token), expiresAt: Date.now() + 86_400_000 });
    return { id, email: email.trim().toLowerCase(), role, token, organizationId: target.organizationId };
  }
  const setting = (key: string, value: unknown) => t.mutation(components.platform.appSettings.putRaw, { key, value: JSON.stringify(value) });
  const rows = async (model: "user" | "organization" | "member" | "session" | "account" | "invitation" | "organizationInvitationClaims" | "organizationEnrollments" | "verification") => (await t.query(components.betterAuth.adapter.findMany, { model, paginationOpts: { cursor: null, numItems: 100 } })).page;
  const findUser = (email: string) => t.query(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] });
  const context = (invitation: Awaited<ReturnType<typeof invite>>) => ({ organizationId: invitation.organizationId, token: invitation.token });
  return { t, org, user, client, organization, invite, setting, rows, findUser, context };
}

describe("canonical invitation-bound member admission", () => {
  test("new identity registers in invite-only mode without customer admission, membership or personal provisioning", async () => {
    const f = await fixture();
    await f.setting("onboardingType", "inviteOnly");
    const invite = await f.invite(" New.Member@Example.Test ");
    expect(await f.t.action(api.platform.memberInvitations.preview, f.context(invite))).toMatchObject({ organizationId: f.org.organizationId, email: invite.email, role: ORG_MEMBER_ROLE });
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    const args = { capability: claim.capability, email: invite.email, name: "New member", password };
    await f.t.action(api.platform.memberInvitations.register, args);
    const user = await f.findUser(invite.email);
    expect(user).toMatchObject({ emailVerified: false, role: "user" });
    expect(user?.customerAdmission).toBeUndefined();
    expect(await f.rows("organization")).toHaveLength(1);
    expect(await f.rows("member")).toHaveLength(1);
    expect(await f.rows("session")).toHaveLength(0);
    const credential = (await f.rows("account")).find(row => row.userId === user!._id);
    await f.t.action(api.platform.memberInvitations.register, { ...args, name: "Retry", password: "different password must never reset the account" });
    expect(await f.findUser(invite.email)).toEqual(user);
    expect((await f.rows("account")).find(row => row.userId === user!._id)).toEqual(credential);
    await f.setting("userEmailVerificationRequired", false);
    const client = await f.client(user!._id);
    await expect(client.mutation(api.platform.memberInvitations.accept, f.context(invite))).rejects.toThrow("EMAIL_VERIFICATION_REQUIRED");
  });

  test("real sign-in, forced email verification and acceptance work with optional ordinary verification", async () => {
    const f = await fixture();
    await f.setting("userEmailVerificationRequired", false);
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    await f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New member", password });
    const user = (await f.findUser(invite.email))!;
    const response = await f.t.fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ email: invite.email, password }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const sessions = await f.rows("session");
    expect(sessions).toHaveLength(1);
    const client = f.t.withIdentity({ subject: user._id, sessionId: sessions[0]._id });
    await client.action(api.platform.memberInvitations.requestVerification, f.context(invite));
    const email = vi.mocked(sendAuthEmail).mock.calls.at(-1)![0];
    expect(email).toMatchObject({ to: invite.email, type: "verification" });
    const link = new URL(email.urlOrCode!);
    const verified = await f.t.fetch(link.pathname + link.search);
    expect(verified.status).toBe(302);
    expect(await f.rows("session")).toEqual(sessions);
    const result = await client.mutation(api.platform.memberInvitations.accept, f.context(invite));
    expect(result).toMatchObject({ organizationId: f.org.organizationId, adminPending: false });
    expect(await f.t.query(components.betterAuth.organizations.context, { organizationId: f.org.organizationId, userId: user._id })).toMatchObject({ role: ORG_MEMBER_ROLE, canManageMembers: false });
    expect(await f.rows("organization")).toHaveLength(1);
    expect(await f.t.mutation(components.betterAuth.organizations.resumeCustomerProvisioning, { userId: user._id })).toBeNull();
  });

  test("existing shared identity joins two intended organizations without replacing credentials or private ownership", async () => {
    const f = await fixture();
    const user = await f.user();
    const personal = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: user._id });
    const projectId = await f.t.run(ctx => ctx.db.insert("projects", { name: "Private", description: "Unchanged", ownerId: user._id, createdAt: Date.now() }));
    const project = await f.t.run(ctx => ctx.db.get(projectId));
    const credential = (await f.rows("account")).find(row => row.userId === user._id);
    const other = await f.organization();
    const first = await f.invite(user.email);
    const second = await f.invite(user.email, ORG_ADMIN_MEMBERSHIP_ROLE, other);
    const client = await f.client(user._id);
    await client.mutation(api.platform.memberInvitations.accept, f.context(first));
    const admin = await client.mutation(api.platform.memberInvitations.accept, f.context(second));
    expect(admin.adminPending).toBe(true);
    expect(await f.t.query(components.betterAuth.organizations.context, { organizationId: other.organizationId, userId: user._id })).toMatchObject({ role: ORG_MEMBER_ROLE, canManageMembers: false });
    expect(await client.query(api.platform.organizationEnrollment.status, { organizationId: other.organizationId })).toMatchObject({ scope: "user", setup: { purpose: "invitation", completed: false } });
    expect(await f.t.query(components.betterAuth.organizations.context, { organizationId: personal.organizationId, userId: user._id })).toMatchObject({ role: ORG_ADMIN_MEMBERSHIP_ROLE, experience: "personal" });
    expect((await f.rows("account")).find(row => row.userId === user._id)).toEqual(credential);
    expect(await f.t.run(ctx => ctx.db.get(projectId))).toEqual(project);
  });

  test("same-recipient acceptance retries are atomic, but replay after membership removal cannot readmit", async () => {
    const f = await fixture();
    const user = await f.user();
    const invite = await f.invite(user.email);
    const client = await f.client(user._id);
    const results = await Promise.all([client.mutation(api.platform.memberInvitations.accept, f.context(invite)), client.mutation(api.platform.memberInvitations.accept, f.context(invite))]);
    expect(results[0]).toEqual(results[1]);
    expect((await f.rows("member")).filter(row => row.userId === user._id)).toHaveLength(1);
    await f.t.mutation(components.betterAuth.organizations.changeMember, { organizationId: f.org.organizationId, actorId: f.org.admin._id, memberId: results[0].memberId, operation: "remove" });
    await expect(client.mutation(api.platform.memberInvitations.accept, f.context(invite))).rejects.toThrow("INVALID_MEMBER_INVITATION");
    expect((await f.rows("member")).filter(row => row.userId === user._id)).toHaveLength(0);
    expect(await f.findUser(user.email)).not.toBeNull();
  });

  test.each([
    ["empty", ORG_MEMBER_ROLE], ["foreign", ORG_MEMBER_ROLE],
    ["empty", ORG_ADMIN_MEMBERSHIP_ROLE], ["foreign", ORG_ADMIN_MEMBERSHIP_ROLE],
  ] as const)("%s context rejects every public invitation operation for %s", async (context, role) => {
    const f = await fixture();
    const user = await f.user();
    const invite = await f.invite(user.email, role);
    const other = await f.organization();
    const client = await f.client(user._id);
    const args = { ...f.context(invite), organizationId: context === "empty" ? "" : other.organizationId };
    const snapshot = () => Promise.all(([
      "user", "account", "organization", "member", "session", "invitation",
      "organizationInvitationClaims", "organizationEnrollments", "verification",
    ] as const).map(model => f.rows(model)));
    const before = await snapshot();
    await expect(f.t.action(api.platform.memberInvitations.preview, args)).rejects.toThrow("INVALID_MEMBER_INVITATION");
    await expect(f.t.action(api.platform.memberInvitations.claim, args)).rejects.toThrow("INVALID_MEMBER_INVITATION");
    await expect(client.action(api.platform.memberInvitations.requestVerification, args)).rejects.toThrow("INVALID_MEMBER_INVITATION");
    await expect(client.mutation(api.platform.memberInvitations.accept, args)).rejects.toThrow("INVALID_MEMBER_INVITATION");
    expect(await snapshot()).toEqual(before);
    expect(sendAuthEmail).not.toHaveBeenCalled();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    expect(claim).toMatchObject({ organizationId: invite.organizationId, email: user.email, role });
    const accepted = await client.mutation(api.platform.memberInvitations.accept, f.context(invite));
    expect(accepted).toMatchObject({ organizationId: invite.organizationId, adminPending: role === ORG_ADMIN_MEMBERSHIP_ROLE });
    const after = await snapshot();
    await expect(client.mutation(api.platform.memberInvitations.accept, args)).rejects.toThrow("INVALID_MEMBER_INVITATION");
    expect(await snapshot()).toEqual(after);
    expect(await client.mutation(api.platform.memberInvitations.accept, f.context(invite))).toEqual(accepted);
  });

  test("wrong recipient, foreign organization, invitation IDs and forged tokens fail closed", async () => {
    const f = await fixture();
    const invite = await f.invite();
    const wrong = await f.user();
    const client = await f.client(wrong._id);
    await expect(client.mutation(api.platform.memberInvitations.accept, f.context(invite))).rejects.toThrow("INVITATION_RECIPIENT_MISMATCH");
    await expect(client.action(api.platform.memberInvitations.requestVerification, f.context(invite))).rejects.toThrow("INVITATION_RECIPIENT_MISMATCH");
    const other = await f.organization();
    await expect(f.t.action(api.platform.memberInvitations.claim, { ...f.context(invite), organizationId: other.organizationId })).rejects.toThrow("INVALID_MEMBER_INVITATION");
    for (const token of [invite.id, "a".repeat(64), "not-a-token"]) await expect(f.t.action(api.platform.memberInvitations.preview, { ...f.context(invite), token })).rejects.toThrow("INVALID_MEMBER_INVITATION");
  });

  test.each(["canceled", "expired", "disabled", "inviter-demoted"])("%s invitations cannot register or admit", async state => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    if (state === "canceled") await f.t.mutation(invites.cancel, { organizationId: f.org.organizationId, actorId: f.org.admin._id, invitationId: invite.id });
    if (state === "expired") vi.setSystemTime(Date.now() + 86_400_001);
    if (state === "disabled") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "organization", where: [{ field: "_id", value: f.org.organizationId }], update: { lifecycle: "disabled" } } });
    if (state === "inviter-demoted") await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "member", where: [{ field: "_id", value: f.org.memberId }], update: { role: ORG_MEMBER_ROLE } } });
    await expect(f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password })).rejects.toThrow(/INVALID_MEMBER_INVITATION|ORGANIZATION_UNAVAILABLE|NOT_ORGANIZATION_ADMIN/);
    const user = await f.user(invite.email);
    const client = await f.client(user._id);
    await expect(client.mutation(api.platform.memberInvitations.accept, f.context(invite))).rejects.toThrow(/INVALID_MEMBER_INVITATION|ORGANIZATION_UNAVAILABLE|NOT_ORGANIZATION_ADMIN/);
    expect((await f.rows("member")).filter(row => row.userId === user._id)).toHaveLength(0);
  });

  test("registration capability expires, is email-bound and cannot overwrite an existing account", async () => {
    const f = await fixture();
    const user = await f.user();
    const invite = await f.invite(user.email);
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    const args = { capability: claim.capability, email: user.email, name: "New", password };
    await expect(f.t.action(api.platform.memberInvitations.register, { ...args, email: "wrong@example.test" })).rejects.toThrow("INVALID_MEMBER_INVITATION");
    await expect(f.t.action(api.platform.memberInvitations.register, args)).rejects.toThrow("ACCOUNT_ALREADY_EXISTS");
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    await expect(f.t.action(api.platform.memberInvitations.register, args)).rejects.toThrow("INVALID_MEMBER_INVITATION");
    expect(await f.findUser(user.email)).toEqual(user);
  });

  test("failed invitation acceptance after account creation never falls back to personal customer provisioning", async () => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    await f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password });
    const user = (await f.findUser(invite.email))!;
    await f.t.mutation(invites.cancel, { organizationId: f.org.organizationId, actorId: f.org.admin._id, invitationId: invite.id });
    expect(await f.t.mutation(components.betterAuth.organizations.resumeCustomerProvisioning, { userId: user._id })).toBeNull();
    expect(await f.rows("organization")).toHaveLength(1);
    expect(await f.rows("member")).toHaveLength(1);
    expect(await f.findUser(invite.email)).toEqual(user);
  });

  test("operator reservations and auth-only/operator sessions cannot become organization members", async () => {
    const f = await fixture();
    const invite = await f.invite("reserved@example.test");
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    await f.t.mutation(components.platform.adminEmails.ensure, { email: invite.email });
    await expect(f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password })).rejects.toThrow("ADMIN_ENROLLMENT_REQUIRED");
    const reserved = await f.user(invite.email);
    await expect((await f.client(reserved._id)).mutation(api.platform.memberInvitations.accept, f.context(invite))).rejects.toThrow("NOT_CUSTOMER");
    const another = await f.invite();
    const operator = await f.user(another.email, "admin");
    await expect((await f.client(operator._id)).mutation(api.platform.memberInvitations.accept, f.context(another))).rejects.toThrow("NOT_CUSTOMER");
    const recipient = await f.user();
    const third = await f.invite(recipient.email);
    await expect((await f.client(recipient._id, "mcp-authorization")).mutation(api.platform.memberInvitations.accept, f.context(third))).rejects.toThrow("NOT_AUTHENTICATED");
  });

  test("cancellation during password breach validation is rechecked before account creation", async () => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    vi.stubGlobal("fetch", vi.fn(async () => {
      await f.t.mutation(invites.cancel, { organizationId: f.org.organizationId, actorId: f.org.admin._id, invitationId: invite.id });
      return new Response("");
    }));
    await expect(f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password })).rejects.toThrow("INVALID_MEMBER_INVITATION");
    expect(await f.findUser(invite.email)).toBeNull();
  });

  test.each(["outage", "breached"])("%s password checks fail closed without account creation", async kind => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    vi.stubGlobal("fetch", vi.fn(async () => kind === "outage" ? new Response("", { status: 503 }) : new Response(breachedPasswordResponse)));
    await expect(f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password })).rejects.toThrow(kind === "outage" ? "PASSWORD_CHECK_UNAVAILABLE" : "PASSWORD_COMPROMISED");
    expect(await f.findUser(invite.email)).toBeNull();
  });

  test("concurrent registration retries create one identity/credential and never a session or tenant", async () => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    const args = { capability: claim.capability, email: invite.email, name: "Concurrent member", password };
    await Promise.all([f.t.action(api.platform.memberInvitations.register, args), f.t.action(api.platform.memberInvitations.register, args)]);
    const user = (await f.findUser(invite.email))!;
    expect((await f.rows("user")).filter(row => row.email === invite.email)).toHaveLength(1);
    expect((await f.rows("account")).filter(row => row.userId === user._id)).toHaveLength(1);
    expect(await f.rows("session")).toHaveLength(0);
    expect(await f.rows("organization")).toHaveLength(1);
  });

  test("pending invited org-admin does not count as the last enrolled org-admin or issue invitations", async () => {
    const f = await fixture();
    const user = await f.user();
    const invite = await f.invite(user.email, ORG_ADMIN_MEMBERSHIP_ROLE);
    await (await f.client(user._id)).mutation(api.platform.memberInvitations.accept, f.context(invite));
    await expect(f.t.mutation(components.betterAuth.organizations.changeMember, { organizationId: f.org.organizationId, actorId: f.org.admin._id, memberId: f.org.memberId, operation: "demote" })).rejects.toThrow("LAST_ORGANIZATION_ADMIN");
    await expect(f.t.mutation(invites.issue, { organizationId: f.org.organizationId, actorId: user._id, email: "other@example.test", role: ORG_MEMBER_ROLE, tokenHash: "a".repeat(64), expiresAt: Date.now() + 60_000 })).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
    const personalUser = await f.user();
    const personal = await f.t.mutation(components.betterAuth.organizations.provisionPersonal, { userId: personalUser._id });
    await expect(f.t.mutation(invites.issue, { organizationId: personal.organizationId, actorId: personalUser._id, email: "other@example.test", role: ORG_MEMBER_ROLE, tokenHash: "b".repeat(64), expiresAt: Date.now() + 60_000 })).rejects.toThrow("NOT_ORGANIZATION_ADMIN");
  });

  test("rotated token invalidates old registration capabilities and previews", async () => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    await f.t.mutation(components.betterAuth.adapter.updateOne, { input: { model: "invitation", where: [{ field: "_id", value: invite.id }], update: { tokenHash: sha256Hex("replacement-token") } } });
    await expect(f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password })).rejects.toThrow("INVALID_MEMBER_INVITATION");
    await expect(f.t.action(api.platform.memberInvitations.preview, f.context(invite))).rejects.toThrow("INVALID_MEMBER_INVITATION");
    expect(await f.findUser(invite.email)).toBeNull();
  });

  test("operator reservation racing registration is rechecked atomically", async () => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    vi.stubGlobal("fetch", vi.fn(async () => {
      await f.t.mutation(components.platform.adminEmails.ensure, { email: invite.email });
      return new Response("");
    }));
    await expect(f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password })).rejects.toThrow("ADMIN_ENROLLMENT_REQUIRED");
    expect(await f.findUser(invite.email)).toBeNull();
  });

  test("verification delivery failure preserves registration and can be retried", async () => {
    const f = await fixture();
    const invite = await f.invite();
    const claim = await f.t.action(api.platform.memberInvitations.claim, f.context(invite));
    await f.t.action(api.platform.memberInvitations.register, { capability: claim.capability, email: invite.email, name: "New", password });
    const user = (await f.findUser(invite.email))!;
    const client = await f.client(user._id);
    vi.mocked(sendAuthEmail).mockRejectedValueOnce(new Error("DELIVERY_UNAVAILABLE"));
    await expect(client.action(api.platform.memberInvitations.requestVerification, f.context(invite))).rejects.toThrow("DELIVERY_UNAVAILABLE");
    expect(await f.findUser(invite.email)).toEqual(user);
    await client.action(api.platform.memberInvitations.requestVerification, f.context(invite));
    expect(vi.mocked(sendAuthEmail).mock.calls).toHaveLength(2);
    expect(await f.rows("organization")).toHaveLength(1);
  });

  test("raw signup cannot use a member invitation to satisfy customer admission", async () => {
    const f = await fixture();
    await f.setting("onboardingType", "inviteOnly");
    const invite = await f.invite();
    const response = await f.t.fetch("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ email: invite.email, name: "Wrong route", password, invitationId: invite.id, token: invite.token }) });
    expect(response.status).not.toBe(200);
    expect(await f.findUser(invite.email)).toBeNull();
    expect(await f.rows("organization")).toHaveLength(1);
    expect(catalogueRows().some(row => /memberInvitations|organizationEnrollment/.test(row.name))).toBe(false);
  });
});
