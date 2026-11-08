"use client";

import { errorCode } from "@web-app-starter/agentic/errors";

import * as React from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { useTenancyStatus } from "./tenancy-required";

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
const message = (error: unknown) => errorCode(error) ?? "Action failed. Please try again.";

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
 * organization with every user. What the install allows comes from a stored check, run in the
 * background when there is none or it has expired; turning a mode on needs a fresh one.
 */
export function TenancySetup() {
  const status = useTenancyStatus();
  const configure = useMutation(api.platform.tenancy.configure);
  const runCheck = useMutation(api.platform.tenancy.check);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const checkState = status && !status.mode && !status.running ? status.check : undefined;
  const expired = !!checkState?.freshUntil && checkState.freshUntil < now;
  // Start a check when there is none, or the last one expired; a failed or stalled one waits for the button.
  const needsCheck = checkState === null || (checkState?.state === "done" && expired);
  React.useEffect(() => {
    if (needsCheck) void runCheck({}).catch((error: unknown) => toast.error(message(error)));
  }, [needsCheck, runCheck]);
  const retry = useMutation(api.platform.tenancy.retry);
  const [mode, setMode] = React.useState<Mode>("organizations");
  const [billingUserId, setBillingUserId] = React.useState("");
  const [adminUserId, setAdminUserId] = React.useState("");
  const [replacementBillingUserId, setReplacementBillingUserId] = React.useState("");
  const [replacementAdminUserId, setReplacementAdminUserId] = React.useState("");
  const [billingName, setBillingName] = React.useState("");
  const [sharedName, setSharedName] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
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
    const canReplaceOwners = status.running.canReplaceOwners;
    // After the organizations exist, only a shared organization left without an owner who can act takes a new admin owner.
    const canReplaceAdmin = status.running.canReplaceAdmin;
    const replaceable = canReplaceOwners ? (["billing", "admin"] as const) : canReplaceAdmin ? (["admin"] as const) : [];
    return (
      <Alert data-testid="tenancy-running">
        <AlertDescription>
          {status.running.failed || status.running.stale ? <>
            {status.running.failed
              ? <>Setup stopped: {status.running.error}. Correct the reported prerequisite, then retry.</>
              : <>Setup stalled: its last step stopped without finishing or reporting an error. Retry it; completed work is kept.</>}
            {replaceable.length > 0 && status.running.mode === "organizations" && <div className="my-3 grid gap-3">
              {replaceable.map(role => <div key={role}>
                <Label htmlFor={`retry-${role}`}>{canReplaceOwners ? `Replacement ${role} owner (optional, before organizations are created)` : "New owner of the shared organization (it has no owner who can act)"}</Label>
                <Select value={role === "billing" ? replacementBillingUserId : replacementAdminUserId} onValueChange={role === "billing" ? setReplacementBillingUserId : setReplacementAdminUserId}>
                  <SelectTrigger id={`retry-${role}`}><SelectValue placeholder="Keep original owner" /></SelectTrigger>
                  <SelectContent>{status.eligibility?.candidates.map(user => <SelectItem key={user.id} value={user.id}>{user.name} ({user.email})</SelectItem>)}</SelectContent>
                </Select>
              </div>)}
            </div>}
            <Button className="ms-2" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await retry({ ...(canReplaceOwners && replacementBillingUserId ? { billingUserId: replacementBillingUserId } : {}), ...((canReplaceOwners || canReplaceAdmin) && replacementAdminUserId ? { adminUserId: replacementAdminUserId } : {}) }); } catch (error) { toast.error(message(error)); } finally { setBusy(false); }
            }}>Retry setup</Button>
          </> : <>Turning on {MODE_COPY[status.running.mode].title}… This page updates when it&apos;s done.</>}
        </AlertDescription>
      </Alert>
    );
  }
  const checkAgain = () => void runCheck({}).catch((error: unknown) => toast.error(message(error)));
  const check = status.eligibility;
  if (!check || !status.check) {
    const progress = status.check;
    return (
      <Card data-testid="tenancy-check">
        <CardHeader>
          <CardTitle className="text-lg">Choose a tenancy mode</CardTitle>
          <CardDescription>Nobody can sign up until you do. The choice is final.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {progress?.state === "failed" || progress?.stale ? <>
            <p>{progress.state === "failed" ? <>Checking this install stopped: {progress.error}</> : <>Checking this install stalled.</>}</p>
            <div><Button variant="outline" onClick={checkAgain}>Check again</Button></div>
          </> : <p className="text-muted-foreground">Checking this install… {progress ? `${progress.users} users and ${progress.organizations} organizations read.` : ""}</p>}
        </CardContent>
      </Card>
    );
  }
  const shared = mode === "organizations" && check.sharedStep;
  const blocked = !check.plans.ready || (mode === "individuals" && !check.individualsAllowed) || !check.complete || expired || status.check.state !== "done";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed || blocked) return;
    setBusy(true);
    try {
      await configure({
        mode,
        ...(shared ? { billingUserId, adminUserId, billingOrganizationName: billingName.trim(), sharedOrganizationName: sharedName.trim() } : {}),
      });
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
        <CardTitle className="text-lg">Choose your tenancy model</CardTitle>
        <CardDescription>{check.plans.ready ? "Your free-forever default plan is ready. You can add more plans after setup." : "An active, free-forever default plan is needed before setup can finish."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-6" onSubmit={(event) => void submit(event)}>
          {!check.plans.ready && (
            <Alert>
              <AlertDescription>
                The default plan must be active and free forever. The seeded Free plan is sufficient.{" "}
                <Link href="/manage/plans" className="underline">Manage plans</Link>
              </AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">
            {status.check.state === "running"
              ? "Checking this install again…"
              : <>Checked {status.check.finishedAt ? new Date(status.check.finishedAt).toLocaleTimeString() : ""}: {check.appUserCount} users. {expired && "That check has expired. "}</>}
            {status.check.state !== "running" && <Button type="button" variant="link" className="h-auto p-0" onClick={checkAgain}>Check again</Button>}
          </p>
          {!check.complete && <Alert><AlertDescription>This install has too many users or organizations to turn a mode on from here.</AlertDescription></Alert>}
          <RadioGroup value={mode} onValueChange={(value) => { setMode(value as Mode); setConfirmed(false); }} className="grid gap-3">
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
          <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            <span>I confirm <strong>{MODE_COPY[mode].title}</strong>. This applies to the whole installation and cannot be changed after setup.</span>
          </label>
          <div>
            <Button type="submit" disabled={!confirmed || busy || blocked || (shared && (!billingUserId || !adminUserId || !billingName.trim() || !sharedName.trim()))}>
              {busy ? "Starting setup…" : "Confirm and finish setup"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
