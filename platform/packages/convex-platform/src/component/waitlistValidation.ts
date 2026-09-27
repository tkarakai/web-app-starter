/** Valid superpower values for the waitlist meta field. */
const VALID_SUPERPOWERS = [
  "coffee-to-code",
  "pixel-perfect",
  "bug-whisperer",
  "spreadsheet-wizard",
  "inbox-zero",
  "parallel-parking",
  "remembering-names",
  "never-burning-toast",
  "explaining-tech",
  "finding-restaurants",
  "staying-calm",
  "other",
] as const;

/** Valid excitement values for the waitlist meta field. */
const VALID_EXCITEMENT = [
  "take-my-money",
  "cant-wait",
  "cautiously-optimistic",
  "just-browsing",
  "friend-made-me",
] as const;

/** Valid role values for the optional waitlist profile fields. */
const VALID_ROLES = [
  "founder",
  "engineering",
  "product",
  "design",
  "agency",
  "other",
] as const;

const MAX_COMPANY_LENGTH = 120;
const MAX_USE_CASE_LENGTH = 500;

/** Validate and parse the JSON meta string. Throws on invalid input. */
export function validateMeta(meta: string): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(meta) as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_META: must be valid JSON");
  }

  if (!Array.isArray(parsed.superpowers) || parsed.superpowers.length === 0) {
    throw new Error("INVALID_META: at least one superpower is required");
  }
  for (const s of parsed.superpowers) {
    if (!(VALID_SUPERPOWERS as readonly string[]).includes(s as string)) {
      throw new Error("INVALID_META: invalid superpower value");
    }
  }

  if (!Array.isArray(parsed.excitement) || parsed.excitement.length === 0) {
    throw new Error("INVALID_META: at least one excitement level is required");
  }
  for (const e of parsed.excitement) {
    if (!(VALID_EXCITEMENT as readonly string[]).includes(e as string)) {
      throw new Error("INVALID_META: invalid excitement value");
    }
  }

  // Optional profile fields: absent is fine, present must be well-formed.
  if (parsed.role !== undefined) {
    if (!(VALID_ROLES as readonly unknown[]).includes(parsed.role)) {
      throw new Error("INVALID_META: invalid role value");
    }
  }
  if (parsed.company !== undefined) {
    if (typeof parsed.company !== "string" || parsed.company.length > MAX_COMPANY_LENGTH) {
      throw new Error("INVALID_META: company must be a string of at most 120 characters");
    }
  }
  if (parsed.useCase !== undefined) {
    if (typeof parsed.useCase !== "string" || parsed.useCase.length > MAX_USE_CASE_LENGTH) {
      throw new Error("INVALID_META: useCase must be a string of at most 500 characters");
    }
  }
}
