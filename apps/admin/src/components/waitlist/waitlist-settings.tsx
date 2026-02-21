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
  const onboardingType = useQuery(api.appSettings.get, {
    key: "onboardingType",
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
      await setSetting({
        key: "onboardingType",
        value: checked ? "publicWaitlist" : "inviteOnly",
      });
      toast.success(
        checked ? "Public waitlist enabled" : "Public waitlist disabled"
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update setting"
      );
    } finally {
      setTogglePending(false);
    }
  };

  if (onboardingType === undefined) {
    return <Skeleton className="h-8 w-32" />;
  }

  const waitlistEnabled = onboardingType === "publicWaitlist";

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
                ? "Enable public waitlist?"
                : "Disable public waitlist?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggle
                ? "Landing will show a \"Join Waitlist\" form. Public self-signup will be turned off."
                : "Public waitlist will be disabled. Onboarding mode will switch to Invite Only."}
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
