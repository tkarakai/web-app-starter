"use client";

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button } from "@web-app-starter/design-system";
import { copy, SignInAgain } from "./organization-view";
export type AvailabilityChange = { organizationId: string; name: string; from: "active" | "disabled"; to: "active" | "disabled" };
export function OrganizationAvailabilityDialog({ change, currentLifecycle, pending, error, onClose, onConfirm }: {
  change: AvailabilityChange; currentLifecycle?: string; pending: boolean; error: "recent" | "failed" | null; onClose: () => void; onConfirm: () => void;
}) {
  const disabling = change.to === "disabled";
  const changed = currentLifecycle !== change.from;
  return <AlertDialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{disabling ? copy.confirmDisable : copy.confirmReactivate}</AlertDialogTitle>
        <AlertDialogDescription className="space-y-2" asChild><div>
          <p className="break-words font-medium text-foreground">{change.name}</p>
          <p>{disabling ? copy.disableDescription : copy.reactivateDescription}</p>
        </div></AlertDialogDescription>
      </AlertDialogHeader>
      {changed ? <p role="alert" className="text-sm text-destructive">{copy.changed}</p> : null}
      {error ? <div role="alert" className="space-y-3 text-sm text-destructive"><p>{error === "recent" ? copy.recentRequired : copy.failed}</p>{error === "recent" ? <SignInAgain /> : null}</div> : null}
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onClose} disabled={pending}>{copy.cancel}</AlertDialogCancel>
        <Button variant={disabling ? "destructive" : "default"} onClick={onConfirm} disabled={pending || changed || error === "recent"}>
          {pending ? copy.pending : disabling ? copy.disable : copy.reactivate}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
