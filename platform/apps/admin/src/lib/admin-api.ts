import { api } from "@repo/backend";
import type { FunctionReturnType } from "convex/server";
import type { ConvexReactClient } from "convex/react";

/** The authenticated provider client, never a new unauthenticated/global client. */
export type OperatorClient = Pick<ConvexReactClient, "query" | "mutation">;

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "admin";
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
};

export type FetchUsersParams = {
  searchValue?: string;
  searchField?: "email" | "name";
  status?: "active" | "banned";
  sortBy?: "createdAt";
  sortDirection?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
};

export type FetchUsersResult = {
  users: AdminUser[];
  isDone: boolean;
  continueCursor: string;
};

type OperatorRow = NonNullable<FunctionReturnType<typeof api.platform.agentUsers.list>>["page"][number];
function operatorDto(user: OperatorRow): AdminUser {
  if (user.role !== "admin") throw new Error("OPERATOR_TARGET_REQUIRED");
  return {
    id: user.id, name: user.name, email: user.email, role: "admin",
    banned: user.banned, banReason: user.banReason ?? null, banExpires: user.banExpires ?? null,
    image: user.image ?? null, createdAt: new Date(user.createdAt), updatedAt: new Date(user.updatedAt),
    emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled,
  };
}

export async function fetchUsers(client: OperatorClient, params: FetchUsersParams): Promise<FetchUsersResult> {
  const result = await client.query(api.platform.agentUsers.list, {
    paginationOpts: { numItems: params.limit ?? 50, cursor: params.cursor ?? null },
    role: "admin", sortBy: "createdAt", sortDirection: params.sortDirection ?? "desc",
    ...(params.searchValue ? { search: params.searchValue, searchField: params.searchField ?? "name" } : {}),
    ...(params.status ? { status: params.status } : {}),
  });
  if (!result) throw new Error("NOT_AUTHENTICATED");
  return { users: result.page.map(operatorDto), isDone: result.isDone, continueCursor: result.continueCursor };
}

// The backend performs authorization and canonical audit writes in the executing mutation.
export async function banUser(client: OperatorClient, userId: string, reason: string, expiresInSeconds?: number): Promise<void> {
  await client.mutation(api.platform.agentUsers.ban, { userId, reason, ...(expiresInSeconds !== undefined ? { expiresInSeconds } : {}) });
}

export async function unbanUser(client: OperatorClient, userId: string): Promise<void> {
  await client.mutation(api.platform.agentUsers.unban, { userId });
}

export type AdminSession = {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  createdAt: Date;
};

export async function listUserSessions(client: OperatorClient, userId: string): Promise<AdminSession[]> {
  const sessions: AdminSession[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result: FunctionReturnType<typeof api.platform.agentUsers.sessions> = await client.query(api.platform.agentUsers.sessions, { userId, paginationOpts: { numItems: 100, cursor } });
    if (!result) throw new Error("NOT_AUTHENTICATED");
    for (const session of result.page) {
      if (session.userId !== userId) throw new Error("OPERATOR_TARGET_REQUIRED");
      sessions.push({ id: session.id, userId: session.userId, ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null, expiresAt: new Date(session.expiresAt), createdAt: new Date(session.createdAt) });
    }
    if (result.isDone) return sessions;
    if (!result.continueCursor || result.continueCursor === cursor) throw new Error("INVALID_SESSION_CURSOR");
    cursor = result.continueCursor;
  }
  throw new Error("OPERATOR_SESSION_SCAN_LIMIT");
}

export async function revokeSession(client: OperatorClient, userId: string, sessionId: string): Promise<void> {
  await client.mutation(api.platform.agentUsers.revokeSession, { userId, sessionId });
}

export async function revokeAllSessions(client: OperatorClient, userId: string): Promise<void> {
  await client.mutation(api.platform.agentUsers.revokeSessions, { userId });
}
