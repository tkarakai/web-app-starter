/** Idempotent imports, called by host copy mutations in the same transaction. */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { legacyDocument } from "./migrationTypes";
import { migrationTableValidator } from "./migrationTables";
import { mapping, snapshot, requireCopying } from "./migrationShared";

const batchValidator = v.union(
  v.object({ table: v.literal("auditTrail"), rows: v.array(legacyDocument.auditTrail) }),
  v.object({ table: v.literal("appSettings"), rows: v.array(legacyDocument.appSettings) }),
  v.object({ table: v.literal("adminEmails"), rows: v.array(legacyDocument.adminEmails) }),
  v.object({ table: v.literal("waitlistEntries"), rows: v.array(legacyDocument.waitlistEntries) }),
  v.object({ table: v.literal("invitationTokens"), rows: v.array(legacyDocument.invitationTokens) }),
  v.object({ table: v.literal("adminInvitations"), rows: v.array(legacyDocument.adminInvitations) }),
  v.object({ table: v.literal("announcements"), rows: v.array(v.object({ ...legacyDocument.announcements.fields, pendingPublishAt: v.optional(v.number()), pendingUnpublishAt: v.optional(v.number()) })) }),
);
export const copy = mutation({
  args: { batch: batchValidator, nextCursor: v.string(), complete: v.boolean() },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
  handler: async (ctx, { batch, nextCursor, complete }) => {
    await requireCopying(ctx);
    if (batch.rows.length > 100) throw new Error("MIGRATION_BATCH_TOO_LARGE");
    let inserted = 0;
    let skipped = 0;
    switch (batch.table) {
      case "auditTrail": {
        for (const row of batch.rows) {
          const sourceSnapshot = snapshot(row);
          const existing = await mapping(ctx, batch.table, row._id);
          if (existing) {
            if (existing.snapshot !== sourceSnapshot || existing.legacyCreationTime !== row._creationTime) throw new Error("MIGRATION_SOURCE_CHANGED:" + row._id);
            if (!await ctx.db.get(existing.componentId as Id<"auditTrail">)) throw new Error("MIGRATION_TARGET_MISSING:" + row._id);
            skipped++;
            continue;
          }
          const { _id, _creationTime, ...fields } = row;
          const componentId = await ctx.db.insert("auditTrail", fields);
          await ctx.db.insert("migrationRows", { table: batch.table, legacyId: _id, legacyCreationTime: _creationTime, componentId, snapshot: sourceSnapshot, schedulesActivated: true });
          inserted++;
        }
        break;
      }
      case "appSettings": {
        for (const row of batch.rows) {
          const sourceSnapshot = snapshot(row);
          const existing = await mapping(ctx, batch.table, row._id);
          if (existing) {
            if (existing.snapshot !== sourceSnapshot || existing.legacyCreationTime !== row._creationTime) throw new Error("MIGRATION_SOURCE_CHANGED:" + row._id);
            if (!await ctx.db.get(existing.componentId as Id<"appSettings">)) throw new Error("MIGRATION_TARGET_MISSING:" + row._id);
            skipped++;
            continue;
          }
          if (await ctx.db.query("appSettings").withIndex("by_key", q => q.eq("key", row.key)).first()) throw new Error("MIGRATION_TARGET_CONFLICT:appSettings:" + row._id);
          const { _id, _creationTime, ...fields } = row;
          const componentId = await ctx.db.insert("appSettings", fields);
          await ctx.db.insert("migrationRows", { table: batch.table, legacyId: _id, legacyCreationTime: _creationTime, componentId, snapshot: sourceSnapshot, schedulesActivated: true });
          inserted++;
        }
        break;
      }
      case "adminEmails": {
        for (const row of batch.rows) {
          const sourceSnapshot = snapshot(row);
          const existing = await mapping(ctx, batch.table, row._id);
          if (existing) {
            if (existing.snapshot !== sourceSnapshot || existing.legacyCreationTime !== row._creationTime) throw new Error("MIGRATION_SOURCE_CHANGED:" + row._id);
            if (!await ctx.db.get(existing.componentId as Id<"adminEmails">)) throw new Error("MIGRATION_TARGET_MISSING:" + row._id);
            skipped++;
            continue;
          }
          if (await ctx.db.query("adminEmails").withIndex("by_email", q => q.eq("email", row.email)).first()) throw new Error("MIGRATION_TARGET_CONFLICT:adminEmails:" + row._id);
          const { _id, _creationTime, ...fields } = row;
          const componentId = await ctx.db.insert("adminEmails", fields);
          await ctx.db.insert("migrationRows", { table: batch.table, legacyId: _id, legacyCreationTime: _creationTime, componentId, snapshot: sourceSnapshot, schedulesActivated: true });
          inserted++;
        }
        break;
      }
      case "waitlistEntries": {
        for (const row of batch.rows) {
          const sourceSnapshot = snapshot(row);
          const existing = await mapping(ctx, batch.table, row._id);
          if (existing) {
            if (existing.snapshot !== sourceSnapshot || existing.legacyCreationTime !== row._creationTime) throw new Error("MIGRATION_SOURCE_CHANGED:" + row._id);
            if (!await ctx.db.get(existing.componentId as Id<"waitlistEntries">)) throw new Error("MIGRATION_TARGET_MISSING:" + row._id);
            skipped++;
            continue;
          }
          if (await ctx.db.query("waitlistEntries").withIndex("by_email", q => q.eq("email", row.email)).first()) throw new Error("MIGRATION_TARGET_CONFLICT:waitlistEntries:" + row._id);
          const { _id, _creationTime, ...fields } = row;
          const componentId = await ctx.db.insert("waitlistEntries", fields);
          await ctx.db.insert("migrationRows", { table: batch.table, legacyId: _id, legacyCreationTime: _creationTime, componentId, snapshot: sourceSnapshot, schedulesActivated: true });
          inserted++;
        }
        break;
      }
      case "invitationTokens": {
        for (const row of batch.rows) {
          const sourceSnapshot = snapshot(row);
          const existing = await mapping(ctx, batch.table, row._id);
          if (existing) {
            if (existing.snapshot !== sourceSnapshot || existing.legacyCreationTime !== row._creationTime) throw new Error("MIGRATION_SOURCE_CHANGED:" + row._id);
            if (!await ctx.db.get(existing.componentId as Id<"invitationTokens">)) throw new Error("MIGRATION_TARGET_MISSING:" + row._id);
            skipped++;
            continue;
          }
          if (await ctx.db.query("invitationTokens").withIndex("by_token", q => q.eq("token", row.token)).first()) throw new Error("MIGRATION_TARGET_CONFLICT:invitationTokens:" + row._id);
          const { _id, _creationTime, ...fields } = row;
          const parent = await mapping(ctx, "waitlistEntries", fields.waitlistEntryId);
          if (!parent) throw new Error("MIGRATION_WAITLIST_PARENT_MISSING:" + fields.waitlistEntryId);
          const componentId = await ctx.db.insert("invitationTokens", { ...fields, waitlistEntryId: parent.componentId as Id<"waitlistEntries"> });
          await ctx.db.insert("migrationRows", { table: batch.table, legacyId: _id, legacyCreationTime: _creationTime, componentId, snapshot: sourceSnapshot, schedulesActivated: true });
          inserted++;
        }
        break;
      }
      case "adminInvitations": {
        for (const row of batch.rows) {
          const sourceSnapshot = snapshot(row);
          const existing = await mapping(ctx, batch.table, row._id);
          if (existing) {
            if (existing.snapshot !== sourceSnapshot || existing.legacyCreationTime !== row._creationTime) throw new Error("MIGRATION_SOURCE_CHANGED:" + row._id);
            if (!await ctx.db.get(existing.componentId as Id<"adminInvitations">)) throw new Error("MIGRATION_TARGET_MISSING:" + row._id);
            skipped++;
            continue;
          }
          if (await ctx.db.query("adminInvitations").withIndex("by_email", q => q.eq("email", row.email)).first()) throw new Error("MIGRATION_TARGET_CONFLICT:adminInvitations:" + row._id);
          const { _id, _creationTime, ...fields } = row;
          const componentId = await ctx.db.insert("adminInvitations", fields);
          await ctx.db.insert("migrationRows", { table: batch.table, legacyId: _id, legacyCreationTime: _creationTime, componentId, snapshot: sourceSnapshot, schedulesActivated: true });
          inserted++;
        }
        break;
      }
      case "announcements": {
        for (const row of batch.rows) {
          const sourceSnapshot = snapshot(row);
          const existing = await mapping(ctx, batch.table, row._id);
          if (existing) {
            if (existing.snapshot !== sourceSnapshot || existing.legacyCreationTime !== row._creationTime) throw new Error("MIGRATION_SOURCE_CHANGED:" + row._id);
            if (!await ctx.db.get(existing.componentId as Id<"announcements">)) throw new Error("MIGRATION_TARGET_MISSING:" + row._id);
            skipped++;
            continue;
          }
          const { _id, _creationTime, publishJobId: sourcePublishJobId, unpublishJobId: sourceUnpublishJobId, pendingPublishAt, pendingUnpublishAt, ...fields } = row;
          const componentId = await ctx.db.insert("announcements", fields);
          await ctx.db.insert("migrationRows", { table: batch.table, legacyId: _id, legacyCreationTime: _creationTime, componentId, snapshot: sourceSnapshot, schedulesActivated: false, sourcePublishJobId, sourceUnpublishJobId, publishAt: pendingPublishAt, unpublishAt: pendingUnpublishAt });
          inserted++;
        }
        break;
      }
    }
    const progress = await ctx.db.query("migrationProgress").withIndex("by_table", q => q.eq("table", batch.table)).unique();
    const update = { cursor: nextCursor, complete };
    if (progress) await ctx.db.patch(progress._id, update);
    else await ctx.db.insert("migrationProgress", { table: batch.table, ...update });
    return { inserted, skipped };
  },
});

/** Explicit reset for a failed table scan; copied rows are rechecked, never overwritten. */
export const restartTable = mutation({
  args: { table: migrationTableValidator },
  returns: v.null(),
  handler: async (ctx, { table }) => {
    await requireCopying(ctx);
    const progress = await ctx.db.query("migrationProgress").withIndex("by_table", q => q.eq("table", table)).unique();
    if (progress) await ctx.db.patch(progress._id, { cursor: null, complete: false });
  },
});
