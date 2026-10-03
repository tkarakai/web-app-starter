/** Trusted app callers only; clients use the authenticated app wrappers. */
import { v } from "convex/values";

import { mutation, query } from "./functions";

import { scheduleAuditEvent } from "./auditTrailHelpers";
import type { AuditStatus } from "./auditTrailConstants";

import { sha256Hex } from "./tokenHash";
import { invitationTokensFields } from "./schema";
const row = v.object({ _id: v.id("invitationTokens"), _creationTime: v.number(), ...invitationTokensFields });

/** Tokens in "claiming" state older than this are considered stale. */
const CLAIMING_TTL_MS = 15 * 60_000; // 15 minutes

export const create = mutation({
  args: {
    generation: v.optional(v.number()),
    waitlistEntryId: v.id("waitlistEntries"),
    tokenHash: v.string(),
    email: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.waitlistEntryId);
    if (!entry || entry.email !== args.email || (entry.invitationGeneration ?? 0) !== (args.generation ?? 0)) throw new Error("STALE_INVITATION_DELIVERY");
    // The `token` field stores a SHA-256 hash, not the raw token.
    await ctx.db.insert("invitationTokens", {
      waitlistEntryId: args.waitlistEntryId,
      token: args.tokenHash,
      email: args.email,
      status: "sent",
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });

    // Denormalize: keep the entry's invitationExpiresAt in sync
    await ctx.db.patch(args.waitlistEntryId, {
      invitationExpiresAt: args.expiresAt,
    });
  
  },
});

export const validate = query({
  args: { token: v.string() },
  returns: v.union(v.object({ valid: v.literal(false), reason: v.union(v.literal("NOT_FOUND"), v.literal("REVOKED"), v.literal("ALREADY_USED"), v.literal("EXPIRED")) }), v.object({ valid: v.literal(true), email: v.string() })),
  handler: async (ctx, args) => {
    const tokenHash = sha256Hex(args.token);
    const tokenDoc = await ctx.db
      .query("invitationTokens")
      .withIndex("by_token", (q) => q.eq("token", tokenHash))
      .unique();

    if (!tokenDoc) return { valid: false as const, reason: "NOT_FOUND" as const };
    if (tokenDoc.status === "revoked")
      return { valid: false as const, reason: "REVOKED" as const };
    if (tokenDoc.status === "claimed" || tokenDoc.status === "claiming")
      return { valid: false as const, reason: "ALREADY_USED" as const };
    if (Date.now() > tokenDoc.expiresAt)
      return { valid: false as const, reason: "EXPIRED" as const };

    return { valid: true as const, email: tokenDoc.email };
  
  },
});

export const beginClaim = mutation({
  args: { token: v.string() },
  returns: v.object({ email: v.string() }),
  handler: async (ctx, args) => {
    const tokenHash = sha256Hex(args.token);

    let email: string | undefined;
    let tokenId: string | undefined;
    let error: unknown;
    let status: AuditStatus = "succeeded";

    try {
      const tokenDoc = await ctx.db
        .query("invitationTokens")
        .withIndex("by_token", (q) => q.eq("token", tokenHash))
        .unique();

      if (!tokenDoc) throw new Error("TOKEN_NOT_FOUND");
      email = tokenDoc.email;
      tokenId = tokenDoc._id;

      if (Date.now() > tokenDoc.expiresAt) throw new Error("TOKEN_EXPIRED");

      // Auto-reset stale "claiming" tokens back to "sent"
      if (tokenDoc.status === "claiming") {
        const claimAge = Date.now() - (tokenDoc.claimStartedAt ?? 0);
        if (claimAge < CLAIMING_TTL_MS) {
          throw new Error("TOKEN_ALREADY_USED");
        }
        // Stale claim — fall through and re-claim
      } else if (tokenDoc.status !== "sent") {
        throw new Error("TOKEN_ALREADY_USED");
      }

      await ctx.db.patch(tokenDoc._id, { status: "claiming", claimStartedAt: Date.now() });
    } catch (e) {
      error = e;
      const msg = e instanceof Error ? e.message : "";
      if (msg === "TOKEN_NOT_FOUND") status = "failed.not_found";
      else if (msg === "TOKEN_EXPIRED") status = "failed.expired";
      else if (msg === "TOKEN_ALREADY_USED") status = "failed.already_used";
      else status = "failed.internal_error";
    } finally {
      await scheduleAuditEvent(ctx, {
        actor: email ?? "unknown",
        sourceDetail: "waitlist-token",
        action: "waitlist.token.claimed",
        resource: tokenId ? `invitation-token:${tokenId}` : `token:unknown`,
        status,
        reason: error instanceof Error ? error.message : undefined,
      });
    }

    if (error) throw error;
    return { email: email! };
  
  },
});

export const finalizeClaim = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = sha256Hex(args.token);

    const tokenDoc = await ctx.db
      .query("invitationTokens")
      .withIndex("by_token", (q) => q.eq("token", tokenHash))
      .unique();

    if (!tokenDoc) throw new Error("TOKEN_NOT_FOUND");
    if (tokenDoc.status !== "claiming") throw new Error("INVALID_TOKEN_STATE");

    const now = Date.now();

    await ctx.db.patch(tokenDoc._id, {
      status: "claimed",
      claimedAt: now,
    });

    // Also update the waitlist entry
    await ctx.db.patch(tokenDoc.waitlistEntryId, {
      status: "claimed",
      claimedAt: now,
    });
  
  },
});

export const releaseClaim = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = sha256Hex(args.token);

    const tokenDoc = await ctx.db
      .query("invitationTokens")
      .withIndex("by_token", (q) => q.eq("token", tokenHash))
      .unique();

    if (!tokenDoc) return;
    if (tokenDoc.status === "claiming") {
      await ctx.db.patch(tokenDoc._id, { status: "sent" });

      await scheduleAuditEvent(ctx, {
        actor: tokenDoc.email,
        sourceDetail: "waitlist-token",
        action: "waitlist.token.released",
        resource: `invitation-token:${tokenDoc._id}`,
        status: "succeeded",
      });
    }
  
  },
});

export const hasValidInvitation = query({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("invitationTokens")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();

    return tokens.some(
      (t) =>
        (t.status === "sent" || t.status === "claiming" || t.status === "claimed") &&
        Date.now() <= t.expiresAt
    );
  
  },
});

export const listByEntry = query({
  args: { waitlistEntryId: v.id("waitlistEntries") },
  returns: v.array(row),
  handler: async (ctx, args) => {

    const tokens = await ctx.db
      .query("invitationTokens")
      .withIndex("by_waitlist_entry", (q) =>
        q.eq("waitlistEntryId", args.waitlistEntryId)
      )
      .collect();

    return tokens.sort((a, b) => b.createdAt - a.createdAt);
  
  },
});
