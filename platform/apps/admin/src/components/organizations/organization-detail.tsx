"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { api } from "@repo/backend";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@web-app-starter/design-system";
import { useAuthUser } from "@/components/auth/auth-guard";
import { OrganizationAvailabilityDialog, type AvailabilityChange } from "./organization-availability-dialog";
import { Availability, copy, experienceLabel, OrganizationBoundary, OrganizationUnavailable, type OrganizationDetail } from "./organization-view";

function Detail({ organizationId }: { organizationId: string }) {
  const organization = useQuery(api.platform.organizations.get, { organizationId }) as OrganizationDetail | null | undefined;
  const setLifecycle = useMutation(api.platform.organizations.setLifecycle);
  const [change, setChange] = useState<AvailabilityChange | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"recent" | "failed" | null>(null);
  const [denied, setDenied] = useState(false);
  const [updated, setUpdated] = useState(false);
  if (organization === undefined) return <p role="status" className="py-8 text-sm text-muted-foreground">{copy.loadingDetail}</p>;
  if (denied || !organization || organization.organizationId !== organizationId) return <OrganizationUnavailable detail />;
  const canChange = organization.lifecycle === "active" || organization.lifecycle === "disabled";
  // Render only the designated contact, never a fallback directory or arbitrary extra DTO fields.
  const contact = organization.contacts.length === 1 ? organization.contacts[0] : null;
  const close = () => { if (!pending) { setChange(null); setError(null); } };
  const confirm = async () => {
    if (!change || pending || change.organizationId !== organizationId || change.from !== organization.lifecycle) return;
    const captured = { organizationId: change.organizationId, lifecycle: change.to };
    setPending(true); setError(null); setUpdated(false);
    try {
      await setLifecycle(captured);
      setChange(null); setUpdated(true);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      if (/NOT_AUTHENTICATED|NOT_ADMIN|APP_OPERATOR_REQUIRED|OPERATOR_TARGET_REQUIRED|ORGANIZATION_UNAVAILABLE/.test(code)) { setDenied(true); setChange(null); }
      else setError(code.includes("RECENT_AUTHENTICATION_REQUIRED") ? "recent" : "failed");
    } finally { setPending(false); }
  };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2"><h1 className="break-words text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <div className="flex flex-wrap items-center gap-3"><Availability value={organization.lifecycle} /><span className="text-sm text-muted-foreground">{copy.experience}: {experienceLabel(organization.experience)}</span></div>
      </div>
    </div>
    {updated ? <p role="status" className="text-sm">{copy.updated}</p> : null}
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="min-w-0"><CardHeader><CardTitle>{copy.currentContact}</CardTitle><CardDescription>{copy.contactDescription}</CardDescription></CardHeader>
        <CardContent>{contact ? <dl className="space-y-4 text-sm"><div><dt className="text-muted-foreground">{copy.name}</dt><dd className="break-words font-medium">{contact.name}</dd></div><div><dt className="text-muted-foreground">{copy.email}</dt><dd className="break-all">{contact.email}</dd></div></dl> : <p className="text-sm text-muted-foreground">{copy.contactUnavailable}</p>}</CardContent>
      </Card>
      <Card className="min-w-0"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck aria-hidden className="size-4" />{copy.availability}</CardTitle><CardDescription>{copy.availabilityDescription}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {organization.lifecycle === "disabled" ? <p className="text-sm text-muted-foreground">{copy.disabledDescription}</p> : null}
          {!canChange ? <p className="text-sm text-muted-foreground">{copy.provisioningDescription}</p> : null}
          <Button disabled={!canChange || pending} variant={organization.lifecycle === "active" ? "destructive" : "default"} onClick={() => {
            if (organization.lifecycle !== "active" && organization.lifecycle !== "disabled") return;
            setError(null); setUpdated(false); setChange({ organizationId, name: organization.name, from: organization.lifecycle, to: organization.lifecycle === "active" ? "disabled" : "active" });
          }}>{organization.lifecycle === "disabled" ? copy.reactivate : copy.disable}</Button>
        </CardContent>
      </Card>
    </div>
    <p className="text-xs text-muted-foreground">{copy.privacyNote}</p>
    {change ? <OrganizationAvailabilityDialog change={change} currentLifecycle={organization.lifecycle} pending={pending} error={error} onClose={close} onConfirm={() => void confirm()} /> : null}
  </div>;
}
export function OrganizationDetails({ organizationId }: { organizationId: string }) {
  const actor = useAuthUser();
  return <section className="mx-auto w-full max-w-5xl space-y-6">
    <Link href="/manage/organizations" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden className="size-4" />{copy.back}</Link>
    <OrganizationBoundary detail key={`${actor?.id ?? "signed-out"}:${organizationId}`}>
      {actor?.id ? <Detail key={organizationId} organizationId={organizationId} /> : <OrganizationUnavailable detail />}
    </OrganizationBoundary>
  </section>;
}
