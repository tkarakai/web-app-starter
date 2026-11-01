"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@repo/backend";

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@web-app-starter/design-system";

export type BanSuccessor = { organizationId: string; userId: string };
type Candidate = { userId: string; name: string; email: string; role: string };
type Needed = { organizationId: string; name: string; candidates: Candidate[]; suggested: string | null };

/**
 * Before a ban: every organization where this user is the only owner who isn't banned, while
 * other members can sign in, needs a new owner. Lists them with a successor picker (the
 * longest-standing admin, else member, preselected) and reports the choices, or `null` while
 * they are still loading.
 */
export function BanSuccessors({ userId, onChange }: { userId: string; onChange: (successors: BanSuccessor[] | null) => void }) {
  const memberships = useQuery(api.platform.adminOrganizations.forUser, { userId });
  const needed = React.useMemo<Needed[] | undefined>(() => {
    if (!Array.isArray(memberships)) return memberships === null ? [] : undefined;
    return memberships.flatMap((m) => m?.banSuccessor
      ? [{ organizationId: m.organizationId, name: m.name, candidates: m.banSuccessor.candidates, suggested: m.banSuccessor.suggested }]
      : []);
  }, [memberships]);
  const [chosen, setChosen] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!needed) return onChange(null);
    onChange(needed.flatMap((n) => {
      const pick = chosen[n.organizationId] ?? n.suggested;
      return pick ? [{ organizationId: n.organizationId, userId: pick }] : [];
    }));
  }, [needed, chosen, onChange]);

  if (needed === undefined) return <Skeleton className="h-12 w-full" />;
  if (needed.length === 0) return null;
  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="ban-successors">
      <p className="text-sm">
        This user is the only owner who can act for {needed.length === 1 ? "this organization" : "these organizations"}.
        Choose who becomes an owner before the ban.
      </p>
      {needed.map((n) => (
        <div key={n.organizationId} className="grid gap-1">
          <Label htmlFor={`successor-${n.organizationId}`}>{n.name || n.organizationId}</Label>
          <Select
            value={chosen[n.organizationId] ?? n.suggested ?? undefined}
            onValueChange={(value) => setChosen((prev) => ({ ...prev, [n.organizationId]: value }))}
          >
            <SelectTrigger id={`successor-${n.organizationId}`} aria-label={`New owner of ${n.name}`}>
              <SelectValue placeholder="Choose a new owner" />
            </SelectTrigger>
            <SelectContent>
              {n.candidates.map((c) => (
                <SelectItem key={c.userId} value={c.userId}>{c.email} ({c.role})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
