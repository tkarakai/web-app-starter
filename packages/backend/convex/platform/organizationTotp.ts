import { constantTimeEqual } from "better-auth/crypto";

/** RFC 4226/6238, matching Better Auth's UTF-8 secret, SHA-1, six digits, 30s. */
export async function organizationTotp(secret: string, now: number): Promise<string> {
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(now / 30_000)));
  const key = await crypto.subtle.importKey("raw", new globalThis.TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = signature[signature.length - 1] & 15;
  const value = new DataView(signature.buffer).getUint32(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

export async function verifyOrganizationTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  for (const delta of [-30_000, 0, 30_000]) if (constantTimeEqual(await organizationTotp(secret, now + delta), code)) return true;
  return false;
}

export function organizationTotpUri(secret: string, issuer: string, email: string) {
  const bits = Array.from(new globalThis.TextEncoder().encode(secret), byte => byte.toString(2).padStart(8, "0")).join("");
  const encoded = (bits + "0000").match(/.{5}/g)!.map(chunk => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[parseInt(chunk, 2)]).join("");
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${encoded}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
