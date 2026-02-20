"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { MailCheck } from "lucide-react";
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
import { EmailVerificationTemplateEditor } from "./email-verification-template-editor";

export function EmailVerificationPolicyCard() {
  const emailVerifRequired = useQuery(api.appSettings.get, {
    key: "emailVerificationRequired",
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
      await setSetting({ key: "emailVerificationRequired", value: String(checked) });
      toast.success(
        checked
          ? "Email verification requirement enabled"
          : "Email verification requirement disabled",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update email verification policy",
      );
    } finally {
      setTogglePending(false);
    }
  };

  const isLoading = emailVerifRequired === undefined;
  // Default is true when the setting has never been stored (null from getPublic default)
  const isEnabled = emailVerifRequired === null ? true : emailVerifRequired === true;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <MailCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">
                Email Verification
              </CardTitle>
              <CardDescription>
                Require users to verify their email address before accessing the app
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
                  id="email-verif-toggle"
                  checked={isEnabled}
                  onCheckedChange={handleToggleRequest}
                  disabled={togglePending}
                />
                <Label htmlFor="email-verif-toggle" className="text-sm font-medium">
                  {isEnabled ? "Required" : "Optional"}
                </Label>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {isEnabled
                  ? "Users must verify their email address before accessing the dashboard. Unverified users are redirected to a verification page."
                  : "Email verification is optional. Users can access the app immediately after signing up without verifying their email."}
              </p>
            </>
          )}
          <EmailVerificationTemplateEditor
            disabled={isLoading || !isEnabled}
            embedded
          />
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
                ? "Require email verification for all users?"
                : "Make email verification optional?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggle
                ? "All users will be required to verify their email address before accessing the app. Existing unverified users will be redirected to a verification page on their next login."
                : "Email verification will become optional. Users will be able to sign in and access the app without verifying their email address. Verification emails will no longer be sent on sign-up."}
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
