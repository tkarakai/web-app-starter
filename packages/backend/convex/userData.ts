import type { MutationCtx } from "./_generated/server";

/**
 * App-owned account cleanup, called with both the auth ID and migrated profile owner ID.
 * Add deletion of user-owned rows here. Shared organization rows belong to organizationData.ts.
 * Keep this idempotent: account deletion may retry after a partial failure.
 */
export async function deleteUserData(_ctx: MutationCtx, _userId: string, _ownerId: string): Promise<void> {
  // The reference app has only organization-owned domain data.
}
