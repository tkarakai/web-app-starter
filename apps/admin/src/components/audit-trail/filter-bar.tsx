"use client";

import { X } from "lucide-react";
import { AUDIT_ACTIONS } from "@repo/backend";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system";

type FilterBarProps = {
  filterAction: string;
  onFilterActionChange: (value: string) => void;
  filterActorType: string;
  onFilterActorTypeChange: (value: string) => void;
  filterStatus: string;
  onFilterStatusChange: (value: string) => void;
  total: number | undefined;
  loading: boolean;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed:invalid_credentials", label: "Failed: invalid credentials" },
  { value: "failed:forbidden", label: "Failed: forbidden" },
  { value: "failed:rate_limited", label: "Failed: rate limited" },
];

const ACTOR_TYPE_OPTIONS = [
  { value: "all", label: "All actor types" },
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
  { value: "system", label: "System" },
];

export function FilterBar({
  filterAction,
  onFilterActionChange,
  filterActorType,
  onFilterActorTypeChange,
  filterStatus,
  onFilterStatusChange,
  total,
  loading,
}: FilterBarProps) {
  const hasActiveFilters =
    filterAction !== "all" ||
    filterActorType !== "all" ||
    filterStatus !== "all";

  const clearFilters = () => {
    onFilterActionChange("all");
    onFilterActorTypeChange("all");
    onFilterStatusChange("all");
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-3">
        <Select value={filterAction} onValueChange={onFilterActionChange}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {AUDIT_ACTIONS.map((action) => (
              <SelectItem key={action} value={action}>
                {action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterActorType} onValueChange={onFilterActorTypeChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Actor type" />
          </SelectTrigger>
          <SelectContent>
            {ACTOR_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={onFilterStatusChange}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}

        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {loading ? "Loading..." : total !== undefined ? `${total} events` : ""}
        </span>
      </div>
    </div>
  );
}
