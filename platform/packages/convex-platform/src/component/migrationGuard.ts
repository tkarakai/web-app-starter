import type { QueryCtx } from "./_generated/server";
import { MIGRATION_NAME } from "./migrationTables";

export async function migrationInProgress(ctx: Pick<QueryCtx, "db">): Promise<boolean> {
  const state = await ctx.db.query("migrationState")
    .withIndex("by_name", q => q.eq("name", MIGRATION_NAME)).unique();
  return state !== null && state.phase !== "complete";
}

export async function assertMigrationComplete(ctx: Pick<QueryCtx, "db">): Promise<void> {
  if (await migrationInProgress(ctx)) throw new Error("PLATFORM_MIGRATION_IN_PROGRESS");
}
