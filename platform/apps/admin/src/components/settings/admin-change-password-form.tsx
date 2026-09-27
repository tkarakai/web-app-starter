"use client";

import { usePasswordStrength } from "@web-app-starter/auth-ui";
import { translatePasswordStrength as t } from "@web-app-starter/i18n/password-strength";

import * as React from "react";

import { authClient } from "@web-app-starter/auth/client";
import {
  Button,
  Checkbox,
  Label,
  PasswordInput,
  toast,
} from "@web-app-starter/design-system";
import {
  PasswordStrengthMeter,
  getMinPasswordLength,
} from "@web-app-starter/design-system/password-strength";
import { useAuthUser } from "@/components/auth/auth-guard";

export function AdminChangePasswordForm() {
  const authUser = useAuthUser();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const { result: strengthResult, valid: isNewPasswordValid } = usePasswordStrength(
    newPassword,
    { email: authUser?.email ?? "", role: "admin" },
  );

  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    isNewPasswordValid &&
    passwordsMatch &&
    !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordsMatch) {
      toast.error("Passwords do not match");
      return;
    }

    if (!isNewPasswordValid) {
      toast.error("Password does not meet strength requirements");
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
          minLength={getMinPasswordLength("admin")}
        />
        <PasswordStrengthMeter result={strengthResult} password={newPassword} t={t} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="admin-confirm-password">Confirm password</Label>
        <PasswordInput
          id="admin-confirm-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={getMinPasswordLength("admin")}
        />
        {confirmPassword && !passwordsMatch ? (
          <p className="text-xs text-destructive">Passwords do not match.</p>
        ) : null}
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

      <Button type="submit" disabled={!canSubmit}>
        {submitting ? "Saving..." : "Update password"}
      </Button>
    </form>
  );
}
