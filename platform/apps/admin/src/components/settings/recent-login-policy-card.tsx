"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@repo/backend";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@web-app-starter/design-system";

export function RecentLoginPolicyCard() {
  const minutes = useQuery(api.platform.appSettings.get, { key: "adminRecentLoginMinutes" });
  const setSetting = useMutation(api.platform.appSettings.set);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const value = draft ?? String(minutes ?? 60);
  const valid = Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 240;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await setSetting({ key: "adminRecentLoginMinutes", value: String(Number(value)) });
      setDraft(null);
      toast.success("Recent login requirement updated");
    } catch {
      toast.error("Could not update the recent login requirement. Verify your identity and try again.");
    } finally { setBusy(false); }
  };
  return <Card>
    <CardHeader>
      <CardTitle className="text-base">Recent Login Requirement</CardTitle>
      <CardDescription>How often administrators must verify their identity for security.</CardDescription>
    </CardHeader>
    <CardContent>
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="admin-recent-login-minutes">Verification interval (minutes)</Label>
          <Input id="admin-recent-login-minutes" type="number" min={1} max={240} step={1} value={value} onChange={event => setDraft(event.target.value)} disabled={minutes === undefined || busy} aria-describedby="admin-recent-login-help" />
          <p id="admin-recent-login-help" className="text-sm text-muted-foreground">Enter 1–240 minutes. Default: 60 minutes. Applies to all administrators, including active sessions. The four-hour session lifetime still applies.</p>
        </div>
        <Button type="submit" disabled={minutes === undefined || busy || !valid || Number(value) === minutes}>{busy ? "Saving…" : "Save"}</Button>
      </form>
    </CardContent>
  </Card>;
}
