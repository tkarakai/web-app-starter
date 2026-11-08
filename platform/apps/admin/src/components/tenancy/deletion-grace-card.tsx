"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@web-app-starter/design-system";

/** How long a user's own deletion request waits before it runs (`userDeletionGraceDays`). */
export function DeletionGraceCard() {
  const current = useQuery(api.platform.appSettings.get, { key: "userDeletionGraceDays" });
  const set = useMutation(api.platform.appSettings.set);
  const [days, setDays] = React.useState("");
  React.useEffect(() => {
    if (typeof current === "number") setDays(String(current));
  }, [current]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(days);
    if (!Number.isInteger(value) || value < 1 || value > 365) return void toast.error("Enter a whole number of days from 1 to 365.");
    try {
      await set({ key: "userDeletionGraceDays", value: String(value) });
      toast.success(`Users are deleted ${value} days after they ask.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update setting");
    }
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="text-lg">User deletion</CardTitle>
        <CardDescription>Users can delete themselves. The deletion waits this many days, and signing in before then lets them cancel it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex items-end gap-2" onSubmit={(event) => void save(event)}>
          <div className="grid gap-2">
            <Label htmlFor="deletion-grace-days">Grace period (days)</Label>
            <Input id="deletion-grace-days" className="w-32" inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
          </div>
          <Button type="submit" variant="outline">Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}
