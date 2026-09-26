import { createTestEnv as createPlatformTest, modules } from "../test.modules";
// Contract: endpoint authorization for every public platform function.
//
// Every public query, mutation and action under convex/platform/ is listed in ACCESS with who
// may call it. A new function fails this test until it is classified, so authorization is a
// decision, not a default. Each function is then called with arguments generated from its own
// validator:
//   - "user" and "admin" functions must refuse an anonymous caller (return null or throw);
//   - "admin" functions must also refuse a signed-in, verified, non-admin user;
//   - "public" functions are callable by anyone and are only checked for being classified.
// Refusal errors must name the reason (REFUSAL), so a function that merely fails on the
// generated arguments is not mistaken for one that checks its caller.
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { components } from "../_generated/api";
import authSchema from "./betterAuth/schema";

type Access = "public" | "user" | "admin";
type Kind = "query" | "mutation" | "action";

const ACCESS: Record<string, Access> = {
  "platform/adminAuth:getEmailVerificationPolicy": "admin",
  "platform/adminAuth:getMfaPolicy": "admin",
  "platform/adminAuth:listAdminPasskeyUserIds": "admin",
  "platform/adminAuth:setEmailVerificationPolicy": "admin",
  "platform/adminAuth:setMfaPolicy": "admin",
  "platform/adminEmails:listProtected": "admin",
  "platform/adminInvitations:advanceOnboardingStep": "user",
  "platform/adminInvitations:claimInvitation": "public", // holder of an invitation token
  "platform/adminInvitations:completeOnboarding": "user",
  "platform/adminInvitations:getMyOnboardingStatus": "user",
  "platform/adminInvitations:invite": "admin",
  "platform/adminInvitations:list": "admin",
  "platform/adminInvitations:remove": "admin",
  "platform/adminInvitations:validateToken": "public",
  "platform/announcements:archive": "admin",
  "platform/announcements:create": "admin",
  "platform/announcements:getActivePublic": "public",
  "platform/announcements:list": "admin",
  "platform/announcements:publishNow": "admin",
  "platform/announcements:remove": "admin",
  "platform/announcements:setLive": "admin",
  "platform/announcements:unpublishNow": "admin",
  "platform/announcements:update": "admin",
  "platform/appSettings:get": "admin",
  "platform/appSettings:getEmailTemplate": "admin",
  "platform/appSettings:getPublic": "public",
  "platform/appSettings:getVerificationEmailTemplate": "admin",
  "platform/appSettings:remove": "admin",
  "platform/appSettings:set": "admin",
  "platform/auditTrail:list": "admin",
  "platform/auditTrail:postEvent": "user",
  "platform/auth:getCurrentUser": "public", // the caller's own user, or null
  "platform/auth:viewBackupCodes": "user",
  "platform/integrations:getStatus": "admin",
  "platform/meta:health": "public",
  "platform/passwordStrength:evaluate": "public",
  "platform/userProfiles:get": "user",
  "platform/userProfiles:getLocale": "user",
  "platform/userProfiles:setLocale": "user",
  "platform/userProfiles:upsert": "user",
  "platform/waitlist:invite": "admin",
  "platform/waitlist:inviteMany": "admin",
  "platform/waitlist:list": "admin",
  "platform/waitlist:remove": "admin",
  "platform/waitlist:uninvite": "admin",
  "platform/waitlistTokens:beginClaim": "public", // holder of a waitlist token
  "platform/waitlistTokens:finalizeClaim": "public",
  "platform/waitlistTokens:listByEntry": "admin",
  "platform/waitlistTokens:releaseClaim": "public",
  "platform/waitlistTokens:validate": "public",
};

const REFUSAL = /NOT_AUTHENTICATED|NOT_ADMIN|UNAUTHENTICATED|Unauthenticated|UNAUTHORIZED|FORBIDDEN|Not authenticated|Unauthorized|Forbidden/;

const SAMPLE_STRING = "contract@example.test";

// One row in each table an admin list reads, so an empty answer to a non-admin is a refusal,
// not an empty table.
async function seed(t: ReturnType<typeof emulator>): Promise<void> {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("adminEmails", { email: "seed-admin@example.test" });
    await ctx.runMutation(components.platform.appSettings.putRaw, { key: SAMPLE_STRING, value: "\"seeded\"" });
    await ctx.db.insert("waitlistEntries", { email: "seed@example.test", meta: "{}", status: "waiting", createdAt: now });
    await ctx.db.insert("adminInvitations", { email: "seed@example.test", status: "invited", invitedAt: now, createdAt: now });
    await ctx.runMutation(components.platform.announcements.create, { name: "seed", bannerText: "seed", identity: { userId: "seed", actor: "seed" } });
    await ctx.runMutation(components.platform.auditTrail.insertEvent, {
      happenedAt: now, actor: "seed", source: "server:seed", action: "auth.sign_in", resource: "seed", status: "succeeded",
    });
  });
}

// Empty is a refusal only because seed() filled the tables.
function isEmpty(result: unknown): boolean {
  if (result === null || (Array.isArray(result) && result.length === 0)) return true;
  const page = (result as { page?: unknown } | undefined)?.page;
  return Array.isArray(page) && page.length === 0;
}

type ValidatorJson = {
  type: string;
  value?: unknown;
  tableName?: string;
  keys?: ValidatorJson;
  values?: { fieldType: ValidatorJson };
};

// A value that passes the validator: the smallest well-formed input, so the call reaches the
// function's own authorization check.
function sample(validator: ValidatorJson): unknown {
  switch (validator.type) {
    case "null": return null;
    case "number": return 1;
    case "bigint": return 1n;
    case "boolean": return false;
    case "string": return SAMPLE_STRING;
    case "bytes": return new ArrayBuffer(0);
    case "any": return {};
    case "literal": return validator.value;
    case "id": return `999999${validator.tableName}`;
    case "array": return [];
    case "record": return {};
    case "union": {
      const members = validator.value as ValidatorJson[];
      return sample(members.find((member) => member.type === "null") ?? members[0]);
    }
    case "object": {
      const fields = validator.value as Record<string, { fieldType: ValidatorJson; optional: boolean }>;
      return Object.fromEntries(Object.entries(fields)
        .filter(([, field]) => !field.optional)
        .map(([name, field]) => [name, sample(field.fieldType)]));
    }
    default: throw new Error(`no sample for validator type ${validator.type}`);
  }
}

type RegisteredFunction = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  exportArgs?: () => string;
};

type PlatformFunction = { path: string; kind: Kind; args: unknown };

async function platformFunctions(): Promise<PlatformFunction[]> {
  const found: PlatformFunction[] = [];
  for (const [key, load] of Object.entries(modules)) {
    if (!key.startsWith("./platform/") || key.includes("/_generated/") || key.startsWith("./platform/betterAuth/")) continue;
    if (/\.test\.[cm]?[jt]s$/.test(key)) continue;
    const module = (await load()) as Record<string, RegisteredFunction>;
    const name = key.slice(2).replace(/\.[cm]?[jt]s$/, "");
    for (const [exportName, fn] of Object.entries(module)) {
      if (!fn || typeof fn !== "function" && typeof fn !== "object" || !fn.isPublic) continue;
      const kind: Kind | undefined = fn.isQuery ? "query" : fn.isMutation ? "mutation" : fn.isAction ? "action" : undefined;
      if (!kind) continue;
      const args = fn.exportArgs ? sample(JSON.parse(fn.exportArgs()) as ValidatorJson) : {};
      found.push({ path: `${name}:${exportName}`, kind, args });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

function emulator() {
  const t = createPlatformTest();
  t.registerComponent("betterAuth", authSchema, import.meta.glob("./betterAuth/**/*.*s"));
  return t;
}

async function fixture() {
  const t = emulator();
  await seed(t);
  return t;
}

type Caller = ReturnType<typeof emulator>;

async function signIn(t: Caller, name: string, role?: string): Promise<Caller> {
  const now = Date.now();
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: { name, email: `${name}@example.test`, emailVerified: true, createdAt: now, updatedAt: now, ...(role ? { role } : {}) },
    },
  });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: { userId: user._id, token: `${name}-contract-session`, expiresAt: now + 3_600_000, createdAt: now, updatedAt: now },
    },
  });
  return t.withIdentity({ subject: user._id, sessionId: session._id }) as unknown as Caller;
}

type Outcome = { refused: true; how: string } | { refused: false; how: string };

async function call(caller: Caller, fn: PlatformFunction): Promise<Outcome> {
  const ref = makeFunctionReference<typeof fn.kind>(fn.path);
  try {
    const result = fn.kind === "query"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await caller.query(ref as any, fn.args as any)
      : fn.kind === "mutation"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? await caller.mutation(ref as any, fn.args as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : await caller.action(ref as any, fn.args as any);
    return isEmpty(result) ? { refused: true, how: `returned ${JSON.stringify(result)}` } : { refused: false, how: `returned ${JSON.stringify(result)?.slice(0, 120)}` };
  } catch (error) {
    const message = (error as Error).message;
    return REFUSAL.test(message) ? { refused: true, how: message } : { refused: false, how: `threw ${message.slice(0, 200)}` };
  }
}

describe("platform endpoint authorization contract", async () => {
  const functions = await platformFunctions();
  const withAccess = (access: Access) => functions.filter((fn) => ACCESS[fn.path] === access)
    .map((fn) => [fn.path, fn] as const);

  // Scheduled work (emails, publish jobs) must not run inside the emulator.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("every public platform function is classified, and every classification exists", () => {
    const paths = functions.map((fn) => fn.path);
    expect(paths.filter((path) => !(path in ACCESS)), "classify these in ACCESS").toEqual([]);
    expect(Object.keys(ACCESS).filter((path) => !paths.includes(path)), "remove these from ACCESS").toEqual([]);
  });

  test.each([...withAccess("user"), ...withAccess("admin")])("%s refuses an anonymous caller", async (_path, fn) => {
    expect(await call(await fixture(), fn)).toMatchObject({ refused: true });
  });

  test.each(withAccess("admin"))("%s refuses a signed-in non-admin", async (_path, fn) => {
    expect(await call(await signIn(await fixture(), "member"), fn)).toMatchObject({ refused: true });
  });

  // The control: an admin gets real answers from the admin queries, so the refusals above are
  // the functions' own checks, not empty tables or unusable arguments.
  // Excluded: they answer [] without data the seed can't make (passkeys in the auth component,
  // tokens of a real waitlist entry). Their non-admin refusals are errors or null, not [].
  const noControl = ["platform/adminAuth:listAdminPasskeyUserIds", "platform/waitlistTokens:listByEntry"];
  test.each(withAccess("admin").filter(([path, fn]) => fn.kind === "query" && !noControl.includes(path)))("%s answers an admin", async (_path, fn) => {
    expect(await call(await signIn(await fixture(), "boss", "admin"), fn)).toMatchObject({ refused: false });
  });
});
