"use client";

import * as React from "react";

import { authClient } from "@repo/auth/client";
import {
  Button,
  Checkbox,
  Label,
  PasswordInput,
  toast,
} from "@repo/design-system";

export function AdminChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });

      if (result.error) {
        toast.error(result.error.message ?? "Current password is incorrect");
        return;
      }

      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setRevokeOtherSessions(false);
    } catch {
      toast.error("Failed to change password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="admin-current-password">Current password</Label>
        <PasswordInput
          id="admin-current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="admin-new-password">New password</Label>
        <PasswordInput
          id="admin-new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          minLength={8}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="admin-confirm-password">Confirm password</Label>
        <PasswordInput
          id="admin-confirm-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={8}
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="admin-revoke-sessions"
          checked={revokeOtherSessions}
          onCheckedChange={(checked) => setRevokeOtherSessions(checked === true)}
        />
        <Label htmlFor="admin-revoke-sessions" className="text-sm font-normal">
          Sign out all other devices
        </Label>
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Update password"}
      </Button>
    </form>
  );
}
