import { components } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";

/** Full-result compatibility with bounded component inputs; no cross-request identity cache. */
export async function filterAppOperatorEmails(ctx: Pick<QueryCtx, "runQuery">, emails: readonly string[], preserveInput = false) {
  const result: string[] = [];
  for (let offset = 0; offset < emails.length; offset += 100) {
    const batch = emails.slice(offset, offset + 100);
    const canonical = await ctx.runQuery(components.betterAuth.appOperators.filterEmails, {
      emails: preserveInput ? batch.map(email => email.toLowerCase()) : batch,
    });
    for (const [index, email] of canonical.entries()) {
      if (email !== null) result.push(preserveInput ? batch[index]! : email);
    }
  }
  return result;
}
