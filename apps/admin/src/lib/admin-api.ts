import { authClient } from "@repo/auth/client";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  banReason: string | null;
  banExpires: number | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  twoFactorEnabled: boolean;
};

export type FetchUsersParams = {
  searchValue?: string;
  searchField?: "email" | "name";
  searchOperator?: "contains" | "starts_with" | "ends_with";
  filterField?: string;
  filterValue?: string | string[];
  filterOperator?: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "contains";
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type FetchUsersResult = {
  users: AdminUser[];
  total: number;
};

export async function fetchUsers(params: FetchUsersParams): Promise<FetchUsersResult> {
  const query: Record<string, string> = {};

  if (params.searchValue) {
    query.searchValue = params.searchValue;
    query.searchField = params.searchField ?? "name";
    query.searchOperator = params.searchOperator ?? "contains";
  }

  if (params.filterField) {
    query.filterField = params.filterField;
    query.filterValue = Array.isArray(params.filterValue)
      ? params.filterValue.join(",")
      : params.filterValue ?? "";
    query.filterOperator = params.filterOperator ?? "eq";
  }

  if (params.sortBy) {
    query.sortBy = params.sortBy;
    query.sortDirection = params.sortDirection ?? "asc";
  }

  if (params.limit != null) {
    query.limit = String(params.limit);
  }

  if (params.offset != null) {
    query.offset = String(params.offset);
  }

  const result = await authClient.admin.listUsers({ query });

  const rawUsers = result.data?.users ?? [];
  const total = (result.data?.total as number) ?? 0;

  return {
    users: rawUsers.map((u) => {
      const raw = u as unknown as Record<string, unknown>;
      return {
        id: u.id,
        name: u.name ?? "",
        email: u.email,
        role: (raw.role as string | null) ?? null,
        banned: u.banned ?? null,
        banReason: u.banReason ?? null,
        banExpires: u.banExpires != null ? new Date(u.banExpires).getTime() : null,
        image: (raw.image as string | null) ?? null,
        createdAt: new Date(u.createdAt),
        updatedAt: new Date((raw.updatedAt as string | number) ?? u.createdAt),
        emailVerified: u.emailVerified ?? false,
        phoneNumber: (raw.phoneNumber as string | null) ?? null,
        phoneNumberVerified: !!(raw.phoneNumberVerified),
        twoFactorEnabled: !!(raw.twoFactorEnabled),
      };
    }),
    total,
  };
}

export async function banUser(
  userId: string,
  banReason: string,
  banExpiresIn?: number,
): Promise<void> {
  const result = await authClient.admin.banUser({
    userId,
    banReason,
    ...(banExpiresIn != null ? { banExpiresIn } : {}),
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Failed to ban user");
  }
}

export async function unbanUser(userId: string): Promise<void> {
  const result = await authClient.admin.unbanUser({ userId });
  if (result.error) {
    throw new Error(result.error.message ?? "Failed to unban user");
  }
}

export async function removeUser(userId: string): Promise<void> {
  const result = await authClient.admin.removeUser({ userId });
  if (result.error) {
    throw new Error(result.error.message ?? "Failed to remove user");
  }
}

export async function setUserRole(userId: string, role: "user" | "admin"): Promise<void> {
  const result = await authClient.admin.setRole({ userId, role });
  if (result.error) {
    throw new Error(result.error.message ?? "Failed to set user role");
  }
}
