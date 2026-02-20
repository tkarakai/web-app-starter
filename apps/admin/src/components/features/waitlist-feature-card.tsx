"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { ListChecks } from "lucide-react";
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
  Input,
  Label,
  Skeleton,
  Switch,
} from "@repo/design-system";
import { EmailTemplateEditor } from "@/components/waitlist/email-template-editor";

export function WaitlistFeatureCard() {
  const onboardingType = useQuery(api.appSettings.get, {
    key: "onboardingType",
  });
  const invitationExpiryDays = useQuery(api.appSettings.get, {
    key: "invitationTokenExpiryDays",
  });
  const setSetting = useMutation(api.appSettings.set);

  const [togglePending, setTogglePending] = React.useState(false);
  const [confirmToggle, setConfirmToggle] = React.useState<boolean | null>(null);
  const [expiryInput, setExpiryInput] = React.useState("");
  const [expiryPending, setExpiryPending] = React.useState(false);

  React.useEffect(() => {
    if (
      invitationExpiryDays !== undefined &&
      invitationExpiryDays !== null
    ) {
      setExpiryInput(String(invitationExpiryDays));
    }
  }, [invitationExpiryDays]);

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
        value: checked ? "waitlist" : "none",
      });
      toast.success(
        checked ? "Waitlist onboarding enabled" : "Waitlist onboarding disabled"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update setting");
    } finally {
      setTogglePending(false);
    }
  };

  const handleExpiryBlur = async () => {
    const num = parseInt(expiryInput, 10);
    if (Number.isNaN(num) || num < 1 || num > 365) {
      toast.error("Token expiry must be between 1 and 365 days");
      setExpiryInput(String(invitationExpiryDays ?? 7));
      return;
    }
    if (num === invitationExpiryDays) return;

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

  const isLoading = onboardingType === undefined;
  const isEnabled = onboardingType === "waitlist";
  const mode = typeof onboardingType === "string" ? onboardingType : "none";

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <ListChecks className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Waitlist</CardTitle>
              <CardDescription>
                Require invitations for new signups
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
                  id="waitlist-toggle"
                  checked={isEnabled}
                  onCheckedChange={handleToggleRequest}
                  disabled={togglePending}
                />
                <Label htmlFor="waitlist-toggle" className="text-sm font-medium">
                  {isEnabled ? "Enabled" : "Disabled"}
                </Label>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {mode === "waitlist"
                  ? "Landing shows the waitlist form. Public self-signup is disabled."
                  : mode === "signup"
                  ? "Public self-signup is enabled. Waitlist onboarding is disabled."
                  : "Both public self-signup and waitlist onboarding are disabled."}
              </p>
              {invitationExpiryDays === undefined ? (
                <Skeleton className="h-8 w-44" />
              ) : (
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor="expiry-days"
                    className="shrink-0 text-sm text-muted-foreground"
                  >
                    Invitation Expiry
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
              )}
            </>
          )}
          <EmailTemplateEditor
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
                ? "Enable waitlist onboarding?"
                : "Disable waitlist onboarding?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmToggle
                ? "Landing will show a \"Join Waitlist\" form. Public self-signup will be turned off."
                : "Waitlist onboarding will be disabled. If signup onboarding is also disabled, landing will only show sign-in."}
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
