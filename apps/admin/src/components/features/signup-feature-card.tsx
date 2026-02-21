"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { UserRoundPlus } from "lucide-react";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Skeleton,
  Switch,
} from "@repo/design-system";

export function SignupFeatureCard() {
  const onboardingType = useQuery(api.appSettings.get, {
    key: "onboardingType",
  });
  const setSetting = useMutation(api.appSettings.set);

  const [togglePending, setTogglePending] = React.useState(false);
  const [confirmToggle, setConfirmToggle] = React.useState<boolean | null>(null);

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
        value: checked ? "publicSignup" : "inviteOnly",
      });
      toast.success(
        checked ? "Public self-signup enabled" : "Public self-signup disabled"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update setting");
    } finally {
      setTogglePending(false);
    }
  };

  const isLoading = onboardingType === undefined;
  const isEnabled = onboardingType === "publicSignup";
  const mode = typeof onboardingType === "string" ? onboardingType : "inviteOnly";

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <UserRoundPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Public Self-Signup</CardTitle>
              <CardDescription>
                Allow public self-service account creation
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-9 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Switch
                  id="signup-toggle"
                  checked={isEnabled}
                  onCheckedChange={handleToggleRequest}
                  disabled={togglePending}
                />
                <Label htmlFor="signup-toggle" className="text-sm font-medium">
                  {isEnabled ? "Enabled" : "Disabled"}
                </Label>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {mode === "publicSignup"
                  ? "Landing shows self-signup and sign-in. Public waitlist is disabled."
                  : mode === "publicWaitlist"
                  ? "Public waitlist is enabled. Public self-signup is disabled."
                  : "Invite-only onboarding is enabled. No public self-service onboarding is available."}
              </p>
            </>
          )}
        </CardContent>
      </Card>

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
                ? "Enable public self-signup?"
                : "Disable public self-signup?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggle
                ? "Landing will show self-signup. Waitlist onboarding will be turned off."
                : "Public self-signup will be disabled. Onboarding mode will switch to Invite Only."}
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
