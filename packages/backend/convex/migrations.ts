/**
 * One-time data migrations.
 *
 * Run from the Convex dashboard or via `bunx convex run migrations:<name>`.
 * Each migration is idempotent — safe to run multiple times.
 */
import { internalMutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// migrateAuditTrailV2 — backfill old audit trail records to new schema
//
// Old shape: { eventId, actorType, receivedAt, ... } (missing: source, authenticatedUserId, truncatedFields)
// New shape: { source, authenticatedUserId?, truncatedFields?, ... } (removed: eventId, actorType, receivedAt)
//
// Strategy: delete old records since audit trail is append-only observational
// data and old records predate the current schema design.
// ---------------------------------------------------------------------------

export const migrateAuditTrailV2 = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allEvents = await ctx.db.query("auditTrail").collect();

    let deleted = 0;
    let kept = 0;

    for (const event of allEvents) {
      const raw = event as Record<string, unknown>;

      // Old records have `actorType` or `eventId` or are missing `source`
      if (raw.actorType !== undefined || raw.eventId !== undefined || raw.source === undefined) {
        await ctx.db.delete(event._id);
        deleted++;
      } else {
        kept++;
      }
    }

    console.log(`[migrateAuditTrailV2] Deleted ${deleted} old records, kept ${kept} new records.`);
    return { deleted, kept };
  },
});
