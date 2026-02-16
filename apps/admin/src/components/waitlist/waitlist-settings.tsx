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
  Label,
  Skeleton,
  Switch,
} from "@repo/design-system";

export function WaitlistSettings() {
  const waitlistEnabled = useQuery(api.appSettings.get, {
    key: "waitlistEnabled",
  });
  const setSetting = useMutation(api.appSettings.set);

  const [togglePending, setTogglePending] = React.useState(false);
  const [confirmToggle, setConfirmToggle] = React.useState<boolean | null>(
    null
  );

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

  if (waitlistEnabled === undefined) {
    return <Skeleton className="h-8 w-32" />;
  }

  return (
    <>
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
