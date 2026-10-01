/** Inclusive UTF-8 limit on the JSON string, including whitespace and escapes. */
export const MAX_WAITLIST_META_BYTES = 16_384;

/**
 * Validate app-owned metadata without prescribing questions or answer types.
 * Accept a JSON object; reject prototype-related keys anywhere in its tree.
 * Check size before parsing, then walk iteratively so even deeply nested input
 * has work and memory bounded by the byte cap, without exhausting the JS stack.
 */
export function validateMeta(meta: string): void {
  // UTF-8 needs at least one byte per UTF-16 code unit. This cheap check avoids
  // allocating an encoded copy of an arbitrarily large string.
  if (meta.length > MAX_WAITLIST_META_BYTES ||
      new globalThis.TextEncoder().encode(meta).byteLength > MAX_WAITLIST_META_BYTES) {
    throw new Error("INVALID_META: exceeds 16384 UTF-8 bytes");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(meta);
  } catch {
    throw new Error("INVALID_META: must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_META: must be a JSON object");
  }

  const pending: object[] = [parsed];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const [key, value] of Object.entries(current)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error("INVALID_META: prohibited key");
      }
      if (value !== null && typeof value === "object") pending.push(value);
    }
  }
}
