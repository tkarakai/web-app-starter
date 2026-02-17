"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { ShieldCheck } from "lucide-react";
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

export function MfaPolicyCard() {
  const mfaRequired = useQuery(api.appSettings.get, {
    key: "emailMfaRequired",
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
      await setSetting({ key: "emailMfaRequired", value: String(checked) });
      toast.success(
        checked
          ? "Email MFA requirement enabled"
          : "Email MFA requirement disabled",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update MFA policy",
      );
    } finally {
      setTogglePending(false);
    }
  };

  const isLoading = mfaRequired === undefined;
  const isEnabled = mfaRequired === true;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">
                Email Multi-Factor Authentication
              </CardTitle>
              <CardDescription>
                Require email-based MFA for all users
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
                  id="mfa-toggle"
                  checked={isEnabled}
                  onCheckedChange={handleToggleRequest}
                  disabled={togglePending}
                />
                <Label htmlFor="mfa-toggle" className="text-sm font-medium">
                  {isEnabled ? "Required" : "Optional"}
                </Label>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {isEnabled
                  ? "All users will be prompted to verify their identity via email code on their next login. Users cannot skip this step."
                  : "Email MFA is optional. Users can choose whether to enable additional verification on their accounts."}
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
                ? "Require email MFA for all users?"
                : "Make email MFA optional?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggle
                ? "All users will be required to verify their identity via an email code on their next login. This adds an extra layer of security but may impact user experience."
                : "Email MFA will become optional. Users who already have MFA enabled will keep it, but new logins will not require verification."}
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
