import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";
import { v } from "convex/values";

import { getMinPasswordLength, REQUIRED_PASSWORD_SCORE, type PasswordRole } from "@web-app-starter/auth/password-policy";
import type { PasswordStrengthResult } from "@web-app-starter/design-system/password-strength";
import { components } from "../_generated/api";

import { query } from "../_generated/server";

// Use key-path translations so zxcvbn returns translatable keys
// instead of hardcoded English strings.
const KEY_TRANSLATIONS: typeof zxcvbnEnPackage.translations = {
  warnings: {
    straightRow: "warnings.straightRow",
    keyPattern: "warnings.keyPattern",
    simpleRepeat: "warnings.simpleRepeat",
    extendedRepeat: "warnings.extendedRepeat",
    sequences: "warnings.sequences",
    recentYears: "warnings.recentYears",
    dates: "warnings.dates",
    topTen: "warnings.topTen",
    topHundred: "warnings.topHundred",
    common: "warnings.common",
    similarToCommon: "warnings.similarToCommon",
    wordByItself: "warnings.wordByItself",
    namesByThemselves: "warnings.namesByThemselves",
    commonNames: "warnings.commonNames",
    userInputs: "warnings.userInputs",
    pwned: "warnings.pwned",
  },
  suggestions: {
    l33t: "suggestions.l33t",
    reverseWords: "suggestions.reverseWords",
    allUppercase: "suggestions.allUppercase",
    capitalization: "suggestions.capitalization",
    dates: "suggestions.dates",
    recentYears: "suggestions.recentYears",
    associatedYears: "suggestions.associatedYears",
    sequences: "suggestions.sequences",
    repeated: "suggestions.repeated",
    longerKeyboardPattern: "suggestions.longerKeyboardPattern",
    anotherWord: "suggestions.anotherWord",
    useWords: "suggestions.useWords",
    noNeed: "suggestions.noNeed",
    pwned: "suggestions.pwned",
  },
  timeEstimation: {
    ltSecond: "timeEstimation.ltSecond",
    second: "timeEstimation.second",
    seconds: "timeEstimation.seconds",
    minute: "timeEstimation.minute",
    minutes: "timeEstimation.minutes",
    hour: "timeEstimation.hour",
    hours: "timeEstimation.hours",
    day: "timeEstimation.day",
    days: "timeEstimation.days",
    month: "timeEstimation.month",
    months: "timeEstimation.months",
    year: "timeEstimation.year",
    years: "timeEstimation.years",
    centuries: "timeEstimation.centuries",
  },
};

let optionsLoaded = false;

function ensureOptions(): void {
  if (optionsLoaded) return;
  zxcvbnOptions.setOptions({
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommonPackage.dictionary,
      ...zxcvbnEnPackage.dictionary,
    },
    translations: KEY_TRANSLATIONS,
  });
  optionsLoaded = true;
}

/** Same evaluation drives both meter feedback and final password acceptance. */
export function evaluatePasswordStrength(password: string, email: string, role: PasswordRole): PasswordStrengthResult {
  ensureOptions();
  const minLength = getMinPasswordLength(role);
  const userInputs = [email, role, "admin", "user", ...email.split(/[@.+]/).filter((p) => p.length > 2)];
  const result = zxcvbn(password, userInputs);
  const tooShort = password.length < minLength;
  return {
    valid: !tooShort && result.score >= REQUIRED_PASSWORD_SCORE,
    score: tooShort ? Math.min(result.score, 2) : result.score,
    warningKey: result.feedback.warning || null,
    suggestionKeys: result.feedback.suggestions,
    crackTimeSeconds: result.crackTimesSeconds.offlineSlowHashing1e4PerSecond as number,
    tooShort,
    minLength,
  };
}

/** Reset links resolve account context server-side without exposing the email. */
export const evaluate = query({
  args: {
    password: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    resetToken: v.optional(v.string()),
  },
  handler: async (ctx, { password, email, role, resetToken }) => {
    if (!password) return null;
    if (resetToken !== undefined) {
      if (!resetToken) return null;
      const verification: { value: string; expiresAt: number } | null = await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        { model: "verification", where: [{ field: "identifier", value: `reset-password:${resetToken}` }] },
      );
      if (!verification || verification.expiresAt <= Date.now()) return null;
      const user: { email: string } | null = await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        { model: "user", where: [{ field: "_id", value: verification.value }] },
      );
      if (!user) return null;
      email = user.email;
      const admin = await ctx.db.query("adminEmails").withIndex("by_email", (q) => q.eq("email", email)).first();
      role = admin ? "admin" : "user";
    }
    return evaluatePasswordStrength(password, email, role);
  },
});

export function validatePasswordStrength(
  password: string,
  email: string,
  role: PasswordRole,
): { valid: boolean; reason?: string } {
  const result = evaluatePasswordStrength(password, email, role);
  if (result.tooShort) return { valid: false, reason: `Password must be at least ${result.minLength} characters` };
  if (!result.valid) return { valid: false, reason: "Password is not strong enough" };
  return { valid: true };
}
