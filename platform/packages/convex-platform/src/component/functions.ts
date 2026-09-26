/** Regular API calls pause while data is copied, verified and schedules are transferred. */
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation as baseMutation, query as baseQuery } from "./_generated/server";
import { assertMigrationComplete } from "./migrationGuard";
export type { MutationCtx, QueryCtx } from "./_generated/server";

export const mutation = customMutation(baseMutation, customCtx(async ctx => {
  await assertMigrationComplete(ctx);
  return {};
}));
export const query = customQuery(baseQuery, customCtx(async ctx => {
  await assertMigrationComplete(ctx);
  return {};
}));
