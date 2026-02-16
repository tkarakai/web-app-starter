"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";
import { useMutation, useQuery } from "convex/react";
import { Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system";
import type { WaitlistEntry } from "./waitlist-actions-context";

type WaitlistFilterBarProps = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  selectedCount: number;
  onBatchInvite: () => void;
  onBatchDelete: () => void;
  table: Table<WaitlistEntry>;
  total: number;
  loading: boolean;
};

function InvitationExpiry() {
  const expiryDays = useQuery(api.appSettings.get, {
    key: "invitationTokenExpiryDays",
  });
  const setSetting = useMutation(api.appSettings.set);

  const [expiryInput, setExpiryInput] = React.useState("");
  const [expiryPending, setExpiryPending] = React.useState(false);

  React.useEffect(() => {
    if (expiryDays !== undefined && expiryDays !== null) {
      setExpiryInput(String(expiryDays));
    }
  }, [expiryDays]);

  const handleExpiryBlur = async () => {
    const num = parseInt(expiryInput, 10);
    if (Number.isNaN(num) || num < 1 || num > 365) {
      toast.error("Token expiry must be between 1 and 365 days");
      setExpiryInput(String(expiryDays ?? 7));
      return;
    }
    if (num === expiryDays) return;

    setExpiryPending(true);
    try {
      await setSetting({
        key: "invitationTokenExpiryDays",
        value: String(num),
      });
      toast.success(`Invitation tokens now expire in ${num} days`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update setting"
      );
    } finally {
      setExpiryPending(false);
    }
  };

  if (expiryDays === undefined) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Label
        htmlFor="expiry-days"
        className="shrink-0 text-sm text-muted-foreground"
      >
        Invitation Expiry
      </Label>
      <Input
        id="expiry-days"
        type="number"
        min={1}
        max={365}
        value={expiryInput || "7"}
        onChange={(e) => setExpiryInput(e.target.value)}
        onBlur={handleExpiryBlur}
        disabled={expiryPending}
        className="h-8 w-16"
      />
      <span className="text-sm text-muted-foreground">days</span>
    </div>
  );
}

export function WaitlistFilterBar({
  searchValue,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  selectedCount,
  onBatchInvite,
  onBatchDelete,
  total,
  loading,
}: WaitlistFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-3">
        <Input
          placeholder="Search by name or email..."
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="claimed">Claimed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {loading ? "Loading..." : `${total} entries`}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {selectedCount > 0 && (
          <>
            <span className="text-sm text-muted-foreground">
              {selectedCount} selected
            </span>
            <Button variant="outline" size="sm" onClick={onBatchInvite}>
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Invite
            </Button>
            <Button variant="destructive" size="sm" onClick={onBatchDelete}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
            <div className="h-4 w-px bg-border" aria-hidden="true" />
          </>
        )}
        <InvitationExpiry />
      </div>
    </div>
  );
}
