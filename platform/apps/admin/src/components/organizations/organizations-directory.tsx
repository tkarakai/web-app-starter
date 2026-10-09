"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@repo/backend";
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@web-app-starter/design-system";
import { useAuthUser } from "@/components/auth/auth-guard";
import { Availability, copy, experienceLabel, OrganizationBoundary, OrganizationUnavailable, type OrganizationPage } from "./organization-view";

function DirectoryPage({ cursor, pageNumber, previous, next }: {
  cursor: string | null; pageNumber: number; previous: () => void; next: (cursor: string) => void;
}) {
  const result = useQuery(api.platform.organizations.list, { paginationOpts: { cursor, numItems: 20 } }) as OrganizationPage | null | undefined;
  if (result === undefined) return <p role="status" className="py-8 text-sm text-muted-foreground">{copy.loading}</p>;
  if (result === null) return <OrganizationUnavailable />;
  const canContinue = !result.isDone && Boolean(result.continueCursor) && result.continueCursor !== cursor;
  return <div className="space-y-4">
    {result.page.length === 0 ? <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">{copy.empty}</div> :
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>{copy.organization}</TableHead><TableHead>{copy.availability}</TableHead><TableHead>{copy.experience}</TableHead><TableHead>{copy.created}</TableHead></TableRow></TableHeader>
          <TableBody>{result.page.map(organization => <TableRow key={organization.organizationId}>
            <TableCell className="max-w-80 whitespace-normal break-words font-medium">
              <Link className="underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2" href={`/manage/organizations/${encodeURIComponent(organization.organizationId)}`}>{organization.name}</Link>
            </TableCell>
            <TableCell><Availability value={organization.lifecycle} /></TableCell>
            <TableCell>{experienceLabel(organization.experience)}</TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">{typeof organization.createdAt === "number" && Number.isFinite(organization.createdAt)
              ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(organization.createdAt) : copy.unknown}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>}
    <nav aria-label={copy.title} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{copy.page} {pageNumber}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={pageNumber === 1} onClick={previous}><ChevronLeft aria-hidden className="size-4" />{copy.previous}</Button>
        <Button variant="outline" size="sm" disabled={!canContinue} onClick={() => { if (canContinue) next(result.continueCursor); }}>{copy.next}<ChevronRight aria-hidden className="size-4" /></Button>
      </div>
    </nav>
  </div>;
}
function Directory() {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors[cursors.length - 1];
  return <DirectoryPage key={cursor ?? "first"} cursor={cursor} pageNumber={cursors.length}
    previous={() => setCursors(current => current.length > 1 ? current.slice(0, -1) : current)}
    next={next => setCursors(current => [...current, next])} />;
}
export function OrganizationsDirectory() {
  const actor = useAuthUser();
  return <section className="mx-auto w-full max-w-6xl space-y-6">
    <div className="flex items-start gap-3"><div className="rounded-lg bg-muted p-2.5"><Building2 aria-hidden className="size-5 text-muted-foreground" /></div>
      <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1><p className="text-sm text-muted-foreground">{copy.description}</p></div>
    </div>
    <OrganizationBoundary key={actor?.id ?? "signed-out"}>{actor?.id ? <Directory /> : <OrganizationUnavailable />}</OrganizationBoundary>
    <p className="text-xs text-muted-foreground">{copy.privacyNote}</p>
  </section>;
}
