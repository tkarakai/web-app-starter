import type { QueryCtx } from "./_generated/server";
import { MIGRATION_NAME, type MigrationTable } from "./migrationTables";

export { snapshot } from "./migrationSnapshot";

export async function state(ctx: Pick<QueryCtx, "db">) {
  return ctx.db.query("migrationState").withIndex("by_name", q => q.eq("name", MIGRATION_NAME)).unique();
}

export async function requireCopying(ctx: Pick<QueryCtx, "db">): Promise<void> {
  if ((await state(ctx))?.phase !== "copying") throw new Error("MIGRATION_NOT_COPYING");
}

export async function mapping(ctx: Pick<QueryCtx, "db">, table: MigrationTable, legacyId: string) {
  return ctx.db.query("migrationRows").withIndex("by_table_legacy", q => q.eq("table", table).eq("legacyId", legacyId)).unique();
}
