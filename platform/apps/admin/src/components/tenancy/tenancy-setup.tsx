"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web-app-starter/design-system";

type Mode = "individuals" | "organizations";
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Failed");

const MODE_COPY: Record<Mode, { title: string; description: string }> = {
  individuals: {
    title: "Plans for Individuals",
    description: "Each user has one organization, shown to them as Billing details. No organization screens, no Create organization and no invitations.",
  },
  organizations: {
    title: "Plans for Organizations",
    description: "Users share data in organizations, and billing organizations pay for them. Owners and admins of a billing organization create organizations and manage their plans.",
  },
};

/**
 * Choose the tenancy mode, once (platform/docs/tenancy-and-billing.md). Until then nobody can
 * sign up. Turning a mode on gives every organization its plan; on an install with users and no
 * shared organizations, organizations mode also creates a billing organization and one shared
 * organization with every user.
 */
export function TenancySetup() {
  const status = useQuery(api.platform.tenancy.status);
  const configure = useMutation(api.platform.tenancy.configure);
  const [mode, setMode] = React.useState<Mode>("organizations");
  const [billingUserId, setBillingUserId] = React.useState("");
  const [adminUserId, setAdminUserId] = React.useState("");
  const [billingName, setBillingName] = React.useState("");
  const [sharedName, setSharedName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (status === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!status) return null;

  if (status.mode) {
    return (
      <Card data-testid="tenancy-mode">
        <CardHeader>
          <CardTitle className="text-lg">{MODE_COPY[status.mode].title}</CardTitle>
          <CardDescription>{MODE_COPY[status.mode].description} The mode can&apos;t be changed.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (status.running) {
    return (
      <Alert data-testid="tenancy-running">
        <AlertDescription>Turning on {MODE_COPY[status.running.mode].title}… This page updates when it&apos;s done.</AlertDescription>
      </Alert>
    );
  }
  const check = status.eligibility!;
  const shared = mode === "organizations" && check.sharedStep;
  const blocked = !check.plans.ready || (mode === "individuals" && !check.individualsAllowed) || !check.complete;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await configure({
        mode,
        ...(shared ? { billingUserId, adminUserId, billingOrganizationName: billingName.trim(), sharedOrganizationName: sharedName.trim() } : {}),
      });
      toast.success(`Turning on ${MODE_COPY[mode].title}.`);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  };

  const userSelect = (id: string, label: string, value: string, onChange: (value: string) => void) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue placeholder="Choose a user" /></SelectTrigger>
        <SelectContent>
          {check.candidates.map((user) => <SelectItem key={user.id} value={user.id}>{user.name} ({user.email})</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Card data-testid="tenancy-setup">
      <CardHeader>
        <CardTitle className="text-lg">Choose a tenancy mode</CardTitle>
        <CardDescription>Nobody can sign up until you do. The choice is final.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-6" onSubmit={(event) => void submit(event)}>
          {!check.plans.ready && (
            <Alert>
              <AlertDescription>
                First define at least one plan besides the seeded free plan, and make sure the default plan is active and free forever.{" "}
                <Link href="/manage/plans" className="underline">Manage plans</Link>
              </AlertDescription>
            </Alert>
          )}
          {!check.complete && <Alert><AlertDescription>This install has too many users or organizations to turn a mode on from here.</AlertDescription></Alert>}
          <RadioGroup value={mode} onValueChange={(value) => setMode(value as Mode)} className="grid gap-3">
            {(Object.keys(MODE_COPY) as Mode[]).map((key) => (
              <label key={key} htmlFor={`mode-${key}`} className="flex cursor-pointer gap-3 rounded-md border p-4 has-[[data-state=checked]]:border-primary">
                <RadioGroupItem id={`mode-${key}`} value={key} className="mt-1" />
                <span className="grid gap-1">
                  <span className="font-medium">{MODE_COPY[key].title}</span>
                  <span className="text-sm text-muted-foreground">{MODE_COPY[key].description}</span>
                  {key === "individuals" && !check.individualsAllowed && (
                    <span className="text-sm text-destructive">Needs every organization to have one member and every user one organization.</span>
                  )}
                </span>
              </label>
            ))}
          </RadioGroup>
          {shared && (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="text-sm text-muted-foreground sm:col-span-2">
                The {check.appUserCount} existing users join one shared organization. The billing user owns a new billing organization that pays for it; the admin owns the shared organization. They may be the same user.
              </p>
              {userSelect("billing-user", "Billing user", billingUserId, setBillingUserId)}
              {userSelect("admin-user", "Admin of the shared organization", adminUserId, setAdminUserId)}
              <div className="grid gap-2">
                <Label htmlFor="billing-org-name">Billing organization name</Label>
                <Input id="billing-org-name" value={billingName} maxLength={100} onChange={(event) => setBillingName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shared-org-name">Shared organization name</Label>
                <Input id="shared-org-name" value={sharedName} maxLength={100} onChange={(event) => setSharedName(event.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Button type="submit" disabled={busy || blocked || (shared && (!billingUserId || !adminUserId || !billingName.trim() || !sharedName.trim()))}>
              Turn on {MODE_COPY[mode].title}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
