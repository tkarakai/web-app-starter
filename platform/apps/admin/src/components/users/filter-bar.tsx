"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";
import { Ban, Unlock } from "lucide-react";

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web-app-starter/design-system";
import type { AdminUser } from "@/lib/admin-api";
import { ColumnSelector } from "./column-selector";
import type { usersTableFeatures } from "./table-features";

type FilterBarProps = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  selectedCount: number;
  onBatchBan: () => void;
  onBatchUnban: () => void;
  table: Table<typeof usersTableFeatures, AdminUser>;
  total: number;
  loading: boolean;
};

export function FilterBar({
  searchValue,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  selectedCount,
  onBatchBan,
  onBatchUnban,
  table,
  total,
  loading,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-3">
        <Input
          placeholder="Search operators by name or email..."
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
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
          </SelectContent>
        </Select>
        <ColumnSelector table={table} />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {loading ? "Loading..." : `${total} ${total === 1 ? "operator" : "operators"} loaded`}
        </span>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {selectedCount} selected
          </span>
          <Button variant="outline" size="sm" onClick={onBatchBan}>
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            Ban
          </Button>
          <Button variant="outline" size="sm" onClick={onBatchUnban}>
            <Unlock className="mr-1.5 h-3.5 w-3.5" />
            Unban
          </Button>
        </div>
      )}
    </div>
  );
}
