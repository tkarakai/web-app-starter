"use client";

import * as React from "react";
import {
  flexRender,
  useTable,
  type ColumnVisibilityState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { useConvex, useQuery } from "convex/react";
import { api } from "@repo/backend";

import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TooltipProvider,
} from "@web-app-starter/design-system";
import type { AdminUser } from "@/lib/admin-api";
import { banUser, unbanUser } from "@/lib/admin-api";
import { useUsers, type OperatorFilters } from "@/hooks/use-users";
import { useAuthUser } from "@/components/auth/auth-guard";
import { createColumns } from "./columns";
import { usersTableFeatures } from "./table-features";
import { FilterBar } from "./filter-bar";
import { BanDialog } from "./ban-dialog";
import { UnbanDialog } from "./unban-dialog";
import { BatchActionDialog } from "./batch-action-dialog";
import { UserActionsProvider } from "./user-actions-context";
import { UserSessionsDialog } from "./user-sessions-dialog";

type UserAction =
  | "ban"
  | "unban"
  | "sessions";

type PendingAction = {
  action: UserAction;
  users: AdminUser[];
};

/** Default column visibility — optional columns hidden by default. */
const DEFAULT_COLUMN_VISIBILITY: ColumnVisibilityState = {
  image: false,
  updatedAt: false,
  emailVerified: false,
  twoFactorEnabled: false,
};

/** Debounce delay for name search (ms). */
const SEARCH_DEBOUNCE = 300;

export function UsersDataTable() {
  const authUser = useAuthUser();
  const currentUserId = authUser?.id;
  const client = useConvex();

  // Bootstrap operator protection is additional to the backend's canonical identity boundary.
  const protectedEmailsList = useQuery(api.platform.adminEmails.listProtected);
  const protectedEmails = React.useMemo(
    () => new Set(protectedEmailsList ?? []),
    [protectedEmailsList],
  );

  // Filter state
  const [searchInput, setSearchInput] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");

  // Table state
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>(DEFAULT_COLUMN_VISIBILITY);

  // Debounce search input.
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // The server owns status/search filtering and the supported creation-time order.
  const filterParams = React.useMemo(() => {
    const params: OperatorFilters = {};

    if (debouncedSearch) {
      params.searchValue = debouncedSearch;
    }

    if (statusFilter === "active" || statusFilter === "banned") params.status = statusFilter;
    if (sorting[0]?.id === "createdAt") {
      params.sortBy = "createdAt";
      params.sortDirection = sorting[0].desc ? "desc" : "asc";
    }

    return params;
  }, [debouncedSearch, statusFilter, sorting]);

  const { users: allUsers, total, loading, loadingMore, hasMore, loadMore, refresh, error } =
    useUsers(filterParams);

  // Client-side sorting for columns that can't be sorted server-side (e.g. boolean fields).
  const sortedUsers = React.useMemo(() => {
    if (sorting.length > 0 && sorting[0].id === "status") {
      const dir = sorting[0].desc ? -1 : 1;
      return [...allUsers].sort((a, b) => {
        const aVal = a.banned === true ? 1 : 0;
        const bVal = b.banned === true ? 1 : 0;
        return (aVal - bVal) * dir;
      });
    }
    return allUsers;
  }, [allUsers, sorting]);

  // Clear selection when filters or sorting change.
  React.useEffect(() => {
    setRowSelection({});
  }, [debouncedSearch, statusFilter, sorting]);

  const columns = React.useMemo(
    () => createColumns({ currentUserId, protectedEmails, searchTerm: debouncedSearch }),
    [currentUserId, protectedEmails, debouncedSearch],
  );

  const table = useTable({
    features: usersTableFeatures,
    data: sortedUsers,
    columns,
    state: { sorting, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting: true,
    getRowId: (row) => row.id,
  });

  // ----- Dialog state -----

  // Ban dialog (single + batch)
  const [banTarget, setBanTarget] = React.useState<AdminUser[] | null>(null);
  const [banPending, setBanPending] = React.useState(false);

  // Unban dialog (single only)
  const [unbanTarget, setUnbanTarget] = React.useState<AdminUser | null>(null);
  const [unbanPending, setUnbanPending] = React.useState(false);

  // Batch action dialog (ban/unban only)
  const [batchAction, setBatchAction] = React.useState<PendingAction | null>(null);
  const [sessionsTarget, setSessionsTarget] = React.useState<AdminUser | null>(null);

  // Ban params ref for batch ban execution
  const batchBanParamsRef = React.useRef<{
    banReason: string;
    banExpiresIn?: number;
  } | null>(null);

  const selectedUsers = React.useMemo(() => {
    const ids = Object.keys(rowSelection).filter((id) => rowSelection[id]);
    return sortedUsers
      .filter((u) => ids.includes(u.id))
      // Exclude self and protected from batch operations
      .filter((u) => u.id !== currentUserId && !protectedEmails.has(u.email));
  }, [rowSelection, sortedUsers, currentUserId, protectedEmails]);

  // ----- Action routing -----

  const handleAction = React.useCallback(
    (action: UserAction, actionUsers: AdminUser[]) => {
      if (action === "sessions") {
        if (actionUsers.length === 1) {
          setSessionsTarget(actionUsers[0]);
        }
      } else if (action === "ban") {
        setBanTarget(actionUsers);
      } else if (action === "unban" && actionUsers.length === 1) {
        setUnbanTarget(actionUsers[0]);
      } else {
        setBatchAction({ action, users: actionUsers });
      }
    },
    [],
  );

  // ----- Ban confirm -----

  const handleBanConfirm = async (banReason: string, banExpiresIn?: number) => {
    if (!banTarget) return;

    if (banTarget.length === 1) {
      setBanPending(true);
      try {
        await banUser(client, banTarget[0].id, banReason, banExpiresIn);
        toast.success(`${banTarget[0].email} has been banned`);
        setBanTarget(null);
        setRowSelection({});
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to ban operator");
      } finally {
        setBanPending(false);
      }
    } else {
      // Batch: close ban dialog, transfer to batch dialog with stored params.
      const usersToProcess = banTarget;
      batchBanParamsRef.current = { banReason, banExpiresIn };
      setBanTarget(null);
      setBatchAction({ action: "ban", users: usersToProcess });
    }
  };

  // ----- Unban confirm -----

  const handleUnbanConfirm = async () => {
    if (!unbanTarget) return;
    setUnbanPending(true);
    try {
      await unbanUser(client, unbanTarget.id);
      toast.success(`${unbanTarget.email} has been unbanned`);
      setUnbanTarget(null);
      setRowSelection({});
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unban operator");
    } finally {
      setUnbanPending(false);
    }
  };

  // ----- Batch action -----

  const handleBatchClose = () => {
    batchBanParamsRef.current = null;
    setBatchAction(null);
    setRowSelection({});
    refresh();
  };

  const handleBatchCancel = () => {
    batchBanParamsRef.current = null;
    setBatchAction(null);
  };

  const batchExecutor = React.useCallback(
    async (user: AdminUser) => {
      if (!batchAction) return;
      if (batchAction.action === "ban") {
        if (user.banned === true) return; // Already banned — skip (defense-in-depth)
        const params = batchBanParamsRef.current;
        await banUser(client, user.id, params?.banReason ?? "", params?.banExpiresIn);
      } else if (batchAction.action === "unban") {
        if (user.banned !== true) return; // Not banned — skip (defense-in-depth)
        await unbanUser(client, user.id);
      }
    },
    [batchAction, client],
  );

  // ----- Label helpers -----

  const actionLabel = (action: UserAction): string => {
    const labels: Record<UserAction, string> = {
      ban: "Ban",
      unban: "Unban",
      sessions: "Sessions",
    };
    return labels[action];
  };

  // Batch description with applicable count info.
  const batchDescriptionText = React.useCallback(
    (action: UserAction, actionUsers: AdminUser[]): string => {
      const totalCount = actionUsers.length;

      if (action === "ban") {
        const applicable = actionUsers.filter((u) => u.banned !== true).length;
        if (applicable === 0) return "None of the selected operators can be banned (all are already banned).";
        if (applicable < totalCount)
          return `${applicable} of ${totalCount} selected operators will be banned (${totalCount - applicable} already banned).`;
        return `Are you sure you want to ban ${totalCount} selected operators?`;
      }
      if (action === "unban") {
        const applicable = actionUsers.filter((u) => u.banned === true).length;
        if (applicable === 0) return "None of the selected operators can be unbanned (none are banned).";
        if (applicable < totalCount)
          return `${applicable} of ${totalCount} selected operators will be unbanned (${totalCount - applicable} not banned).`;
        return `Are you sure you want to unban ${totalCount} selected operators?`;
      }
      return `Are you sure you want to ${action} ${totalCount} selected operators?`;
    },
    [],
  );

  // Compute applicable users for batch operations.
  const batchApplicableUsers = React.useMemo(() => {
    if (!batchAction) return [];
    if (batchAction.action === "ban") return batchAction.users.filter((u) => u.banned !== true);
    if (batchAction.action === "unban") return batchAction.users.filter((u) => u.banned === true);
    return batchAction.users;
  }, [batchAction]);

  return (
    <UserActionsProvider onAction={handleAction}>
      <TooltipProvider>
        <div className="space-y-4">
          <FilterBar
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            selectedCount={selectedUsers.length}
            onBatchBan={() => handleAction("ban", selectedUsers)}
            onBatchUnban={() => handleAction("unban", selectedUsers)}
            table={table}
            total={total}
            loading={loading}
          />

          {error && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            <span>{error}</span><Button variant="outline" size="sm" onClick={refresh}>Retry</Button>
          </div>}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      {table.getVisibleFlatColumns().map((col) => (
                        <TableCell key={`skeleton-${i}-${col.id}`}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={table.getVisibleFlatColumns().length}
                      className="h-24 text-center"
                    >
                      No operators found.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() ? "selected" : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </div>
      </TooltipProvider>

      {/* Ban dialog (single + batch collection) */}
      {banTarget && (
        <BanDialog
          open
          onOpenChange={(open) => {
            if (!open) setBanTarget(null);
          }}
          users={banTarget}
          pending={banPending}
          onConfirm={handleBanConfirm}
        />
      )}

      {/* Unban dialog (single) */}
      {unbanTarget && (
        <UnbanDialog
          open
          onOpenChange={(open) => {
            if (!open) setUnbanTarget(null);
          }}
          user={unbanTarget}
          pending={unbanPending}
          onConfirm={handleUnbanConfirm}
        />
      )}

      {/* Batch action dialog with progress */}
      {batchAction && batchAction.users.length > 0 && (
        <BatchActionDialog
          open
          onClose={handleBatchClose}
          onCancel={handleBatchCancel}
          title={`${actionLabel(batchAction.action)} ${batchAction.users.length} operators`}
          description={batchDescriptionText(batchAction.action, batchAction.users)}
          confirmLabel={`${actionLabel(batchAction.action)} all`}
          users={batchApplicableUsers}
          action={batchExecutor}
          confirmDisabled={batchApplicableUsers.length === 0}
        />
      )}

      <UserSessionsDialog
        open={sessionsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSessionsTarget(null);
        }}
        user={sessionsTarget}
      />
    </UserActionsProvider>
  );
}
