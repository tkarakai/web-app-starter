"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import {
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

  // Sync expiry input with server value
  React.useEffect(() => {
    if (expiryDays !== undefined && expiryDays !== null) {
      setExpiryInput(String(expiryDays));
    }
  }, [expiryDays]);

  const handleToggle = async (checked: boolean) => {
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
    return <Skeleton className="h-36 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Waitlist Mode</CardTitle>
        <CardDescription>
          When enabled, new signups require an invitation. The landing page shows
          a &ldquo;Join Waitlist&rdquo; form instead of the &ldquo;Sign
          Up&rdquo; button.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="waitlist-toggle"
            checked={waitlistEnabled === true}
            onCheckedChange={handleToggle}
            disabled={togglePending}
          />
          <Label htmlFor="waitlist-toggle">
            {waitlistEnabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="expiry-days" className="shrink-0">
            Invitation expiry (days)
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
            className="w-24"
          />
        </div>
      </CardContent>
    </Card>
  );
}
