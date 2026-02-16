import { v } from "convex/values";

import { internalQuery, query } from "./_generated/server";
import type { EmailTemplate } from "./emailTemplates";
import { DEFAULT_EMAIL_TEMPLATE } from "./emailTemplates";
import { authedMutation, authedQuery } from "./functions";

/** Keys that unauthenticated callers may read via getPublic. */
const PUBLIC_KEYS = ["waitlistEnabled"] as const;

/** All valid setting keys and their value validators. */
const VALID_KEYS = [
  "waitlistEnabled",
  "invitationTokenExpiryDays",
  "invitationEmailTemplate",
  "emailMfaRequired",
] as const;

/** Default values returned when a key has never been set. */
const DEFAULTS: Record<string, unknown> = {
  waitlistEnabled: true,
  invitationTokenExpiryDays: 7,
  emailMfaRequired: false,
};

function getDefault(key: string): unknown {
  return DEFAULTS[key] ?? null;
}

/** Max size for the email template JSON value (50 KB). */
const MAX_TEMPLATE_SIZE = 50_000;

/** Validate the JSON-encoded value for a given key. Throws on invalid input. */
function validateValue(key: string, value: string): void {
  if (key === "waitlistEnabled") {
    if (value !== "true" && value !== "false") {
      throw new Error(
        "INVALID_VALUE: waitlistEnabled must be 'true' or 'false'"
      );
    }
  } else if (key === "invitationTokenExpiryDays") {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num < 1 || num > 365) {
      throw new Error(
        "INVALID_VALUE: invitationTokenExpiryDays must be an integer between 1 and 365"
      );
    }
  } else if (key === "emailMfaRequired") {
    if (value !== "true" && value !== "false") {
      throw new Error(
        "INVALID_VALUE: emailMfaRequired must be 'true' or 'false'"
      );
    }
  } else if (key === "invitationEmailTemplate") {
    if (value.length > MAX_TEMPLATE_SIZE) {
      throw new Error(
        `INVALID_VALUE: invitationEmailTemplate exceeds ${MAX_TEMPLATE_SIZE} bytes`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(
        "INVALID_VALUE: invitationEmailTemplate must be valid JSON"
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).subject !== "string" ||
      typeof (parsed as Record<string, unknown>).html !== "string" ||
      typeof (parsed as Record<string, unknown>).text !== "string"
    ) {
      throw new Error(
        "INVALID_VALUE: invitationEmailTemplate must have subject, html, and text string fields"
      );
    }
    const tpl = parsed as EmailTemplate;
    if (!tpl.subject.trim()) {
      throw new Error(
        "INVALID_VALUE: invitationEmailTemplate subject cannot be empty"
      );
    }
    if (!tpl.html.includes("{{invitation_link}}")) {
      throw new Error(
        "INVALID_VALUE: invitationEmailTemplate html must contain {{invitation_link}}"
      );
    }
    if (!tpl.text.includes("{{invitation_link}}")) {
      throw new Error(
        "INVALID_VALUE: invitationEmailTemplate text must contain {{invitation_link}}"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public query — only for allow-listed keys (used by landing page via httpAction)
// ---------------------------------------------------------------------------

export const getPublic = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (!(PUBLIC_KEYS as readonly string[]).includes(args.key)) return null;

    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    return setting ? JSON.parse(setting.value) : getDefault(args.key);
  },
});

// ---------------------------------------------------------------------------
// Admin query — read any setting
// ---------------------------------------------------------------------------

export const get = authedQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") return null;

    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    return setting ? JSON.parse(setting.value) : getDefault(args.key);
  },
});

// ---------------------------------------------------------------------------
// Admin query — get effective email template (custom or default) + isCustom
// ---------------------------------------------------------------------------

export const getEmailTemplate = authedQuery({
  args: {},
  handler: async (ctx) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") return null;

    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "invitationEmailTemplate"))
      .unique();

    if (setting) {
      const template = JSON.parse(setting.value) as EmailTemplate;
      return { ...template, isCustom: true as const };
    }

    return { ...DEFAULT_EMAIL_TEMPLATE, isCustom: false as const };
  },
});

// ---------------------------------------------------------------------------
// Admin mutation — upsert a setting
// ---------------------------------------------------------------------------

export const set = authedMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

    if (!(VALID_KEYS as readonly string[]).includes(args.key)) {
      throw new Error("INVALID_SETTING_KEY");
    }

    validateValue(args.key, args.value);

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
        updatedBy: ctx.ownerId,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Admin mutation — remove a setting (resets to default)
// ---------------------------------------------------------------------------

export const remove = authedMutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") throw new Error("NOT_ADMIN");

    if (!(VALID_KEYS as readonly string[]).includes(args.key)) {
      throw new Error("INVALID_SETTING_KEY");
    }

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Internal query — for use in databaseHooks, httpActions, etc.
// ---------------------------------------------------------------------------

export const getInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    return setting ? JSON.parse(setting.value) : getDefault(args.key);
  },
});
