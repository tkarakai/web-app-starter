/**
 * Disposable user fixtures for E2E tests.
 *
 * The auth E2E suite used to share the single dev-seed account, which made every
 * mutating test unsafe: a failure part-way through left the account on a changed
 * password or with 2FA enabled, breaking every later test and local development
 * until the Convex state was wiped.
 *
 * This gives each test its own throwaway account instead. Tests cannot simply
 * sign up, because `onboardingType` defaults to `inviteOnly` — so this mints the
 * invitation rows first, exactly as `devSeed` does, then creates the user
 * through Better Auth and marks the address verified.
 *
 * Requests require the local runtime, loopback app/backend origins and a random
 * harness capability provisioned by the local launcher. The reserved address
 * and password checks constrain fixture contents; they are not authorization.
 * Hosted deployment preflight rejects fixture configuration.
 *
 * Accounts are create-only and never reused. CI gets a fresh backend per run;
 * locally they accumulate harmlessly in a disposable database.
 */

import { v } from "convex/values";
import { betterAuth } from "better-auth";

import { components, internal } from "../_generated/api";
import { httpAction, internalMutation } from "../_generated/server";
import { createAuthOptions } from "./auth";
import { assertLocalFixtures, authorizeFixtureRequest } from "./localFixtures";
import { validatePasswordStrength } from "./passwordStrength";

/**
 * Fixture addresses are confined to a reserved TLD that cannot receive mail.
 * Anything else is rejected before a user is created.
 */
const E2E_EMAIL_PATTERN = /^e2e-[a-z0-9-]{1,60}@e2e\.local$/;

/** Mirrors the app's own credential minimum. */
const MIN_PASSWORD_LENGTH = 12;

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not available" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Internal mutation: mint the invitation rows that let signup through
// ---------------------------------------------------------------------------

/**
 * Creates the claimed waitlist entry and `claiming` invitation token that
 * `hasValidInvitation` looks for, so `inviteOnly` mode admits this address.
 *
 * Mirrors `devSeed.setupDevUser`, but keyed to a fixture address and always
 * non-admin unless asked otherwise.
 */
export const prepareE2eInvitation = internalMutation({
  args: {
    email: v.string(),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertLocalFixtures();
    if (!E2E_EMAIL_PATTERN.test(args.email)) {
      throw new Error("E2E_EMAIL_REJECTED");
    }


    await ctx.runMutation(components.platform.invitationFixtures.prepare, { email: args.email, meta: JSON.stringify({ superpowers: ["e2e"], excitement: ["e2e"] }), token: `e2e-fixture-${args.email}`, ttlMs: 24 * 60 * 60_000 });
  },
});

/** Moves the fixture's invitation token to `claimed` once signup succeeds. */
export const finalizeE2eInvitation = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    assertLocalFixtures();
    if (!E2E_EMAIL_PATTERN.test(args.email)) {
      throw new Error("E2E_EMAIL_REJECTED");
    }

    await ctx.runMutation(components.platform.invitationFixtures.finalize, args);
  },
});

// ---------------------------------------------------------------------------
// HTTP: create a disposable user
// ---------------------------------------------------------------------------

/**
 * POST /api/dev/e2e-user
 * Body: { email, password, name?, isAdmin? }
 *
 * Creates a verified, ready-to-sign-in account for the given fixture address.
 * Returns 404 unless dev fixtures are enabled, 400 if the address or password
 * fails validation.
 */
export const createE2eUser = httpAction(async (ctx, request) => {
  if (!authorizeFixtureRequest(request)) return notFound();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("INVALID_JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("INVALID_JSON");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "E2E User";
  const isAdmin = body.isAdmin === true;

  if (!E2E_EMAIL_PATTERN.test(email)) {
    return badRequest("E2E_EMAIL_REJECTED");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return badRequest("PASSWORD_TOO_SHORT");
  }
  // Programmatic signUpEmail does not invoke onRequest plugins. Apply the same
  // native strength policy explicitly before preparing any invitation rows.
  if (!validatePasswordStrength(password, email, isAdmin ? "admin" : "user").valid) {
    return badRequest("PASSWORD_TOO_WEAK");
  }

  // Only this capability-authorized local fixture path omits the network breach
  // lookup. Keep Better Auth's hashing, password-strength validation and database
  // hooks; ordinary signup/change/reset paths still use the complete plugin set.
  // A third-party outage must not prevent unrelated E2E tests from signing in.
  assertLocalFixtures();
  const options = createAuthOptions(ctx);
  const auth = betterAuth({
    ...options,
    plugins: options.plugins.filter(plugin => plugin.id !== "have-i-been-pwned"),
  });
  const authContext = await auth.$context;
  if (await authContext.internalAdapter.findUserByEmail(email)) return badRequest("FIXTURE_ALREADY_EXISTS");

  // 1. Admit the address past inviteOnly gating.
  await ctx.runMutation(internal.platform.e2eFixtures.prepareE2eInvitation, { email, isAdmin });

  // 2. Create the account through Better Auth so the password is hashed and
  //    every database hook runs exactly as it would for a real signup (without
  //    the external breached-password lookup for this disposable fixture).
  let createdUserId: string;
  try {
    const result = await auth.api.signUpEmail({ body: { email, password, name } });
    if (!result?.user) {
      return badRequest("SIGNUP_FAILED");
    }
    createdUserId = result.user.id;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return badRequest(`SIGNUP_FAILED: ${message}`);
  }

  // 3. Mark the address verified — fixtures have no inbox to click through.
  await authContext.internalAdapter.updateUser(createdUserId, { emailVerified: true, role: isAdmin ? "admin" : "user" });
  if (isAdmin) await ctx.runMutation(components.platform.adminEmails.ensure, { email });

  await ctx.runMutation(internal.platform.e2eFixtures.finalizeE2eInvitation, { email });

  return new Response(JSON.stringify({ ok: true, email }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
