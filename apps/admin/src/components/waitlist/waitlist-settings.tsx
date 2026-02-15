"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Label,
  Skeleton,
  Switch,
} from "@repo/design-system";

export function WaitlistSettings() {
  const waitlistEnabled = useQuery(api.appSettings.get, {
    key: "waitlistEnabled",
  });
  const expiryDays = useQuery(api.appSettings.get, {
    key: "invitationTokenExpiryDays",
  });
  const setSetting = useMutation(api.appSettings.set);

  const [expiryInput, setExpiryInput] = React.useState("");
  const [expiryPending, setExpiryPending] = React.useState(false);
  const [togglePending, setTogglePending] = React.useState(false);
  const [confirmToggle, setConfirmToggle] = React.useState<boolean | null>(
    null
  );

  // Sync expiry input with server value
  React.useEffect(() => {
    if (expiryDays !== undefined && expiryDays !== null) {
      setExpiryInput(String(expiryDays));
    }
  }, [expiryDays]);

  const handleToggleRequest = (checked: boolean) => {
    setConfirmToggle(checked);
  };

  const handleToggleConfirm = async () => {
    if (confirmToggle === null) return;
    const checked = confirmToggle;
    setConfirmToggle(null);
    setTogglePending(true);
    try {
      await setSetting({ key: "waitlistEnabled", value: String(checked) });
      toast.success(
        checked ? "Waitlist mode enabled" : "Waitlist mode disabled"
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update setting"
      );
    } finally {
      setTogglePending(false);
    }
  };

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

  if (waitlistEnabled === undefined) {
    return <Skeleton className="h-8 w-48" />;
  }

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="waitlist-toggle"
            checked={waitlistEnabled === true}
            onCheckedChange={handleToggleRequest}
            disabled={togglePending}
          />
          <Label htmlFor="waitlist-toggle" className="text-sm font-medium">
            {waitlistEnabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
        <div className="h-4 w-px bg-border" aria-hidden="true" />
        <div className="flex items-center gap-1.5">
          <Label
            htmlFor="expiry-days"
            className="shrink-0 text-sm text-muted-foreground"
          >
            Expiry
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
      </div>

      <AlertDialog
        open={confirmToggle !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmToggle(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmToggle
                ? "Enable waitlist mode?"
                : "Disable waitlist mode?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggle
                ? "New signups will require an invitation. The landing page will show a \"Join Waitlist\" form instead of the \"Sign Up\" button."
                : "Anyone will be able to sign up freely. The waitlist form will be replaced with the standard sign-up flow."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleConfirm}>
              {confirmToggle ? "Enable" : "Disable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
