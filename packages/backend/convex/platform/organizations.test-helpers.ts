// Shared by the organization tests. The extra dot keeps this file out of Convex deployment.
import type { TestConvex } from "convex-test";

import { api, components } from "../_generated/api";
import type schema from "../schema";

/**
 * Helpers over a test deployment that has the real Better Auth component registered (the
 * caller registers it: this file stays free of the test-only module glob).
 */
export async function organizationFixture(t: TestConvex<typeof schema>) {
  async function user(name: string, extra: { emailVerified?: boolean; userId?: string } = {}) {
    const now = Date.now();
    const account = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: {
        name, email: `${name}@example.test`, emailVerified: extra.emailVerified ?? true,
        createdAt: now, updatedAt: now, ...(extra.userId ? { userId: extra.userId } : {}),
      } },
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { assuranceVersion: 1, authMethod: "password", authenticatedAt: now, primaryVerifiedAt: now,
        userId: account._id, token: `${name}-session`, createdAt: now, updatedAt: now, expiresAt: now + 3600_000,
      } },
    });
    const caller = t.withIdentity({ subject: account._id, sessionId: session._id });
    return {
      caller,
      userId: account._id,
      sessionId: session._id,
      /** What Better Auth's `organization.setActive` does to the session row. */
      switchTo: (organizationId: string | null) => t.mutation(components.betterAuth.adapter.updateOne, {
        input: { model: "session", where: [{ field: "_id", value: session._id }], update: { activeOrganizationId: organizationId } },
      }),
    };
  }

  const addMember = (organizationId: string, userId: string, role: string) =>
    t.mutation(components.betterAuth.adapter.create, {
      input: { model: "member", data: { organizationId, userId, role, createdAt: Date.now() } },
    });

  const members = async (organizationId: string) => (await t.query(components.betterAuth.adapter.findMany, {
    model: "member", where: [{ field: "organizationId", value: organizationId }], paginationOpts: { numItems: 100, cursor: null },
  })).page as { _id: string; userId: string; role: string }[];

  return { t, user, addMember, members };
}

export type Caller = Awaited<ReturnType<Awaited<ReturnType<typeof organizationFixture>>["user"]>>["caller"];
export const activeOrganization = async (caller: Caller) => (await caller.query(api.platform.organizations.mine, {}))!.activeOrganizationId!;
