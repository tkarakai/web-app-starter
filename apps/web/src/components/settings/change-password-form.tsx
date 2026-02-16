"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { authClient } from "@repo/auth/client";
import {
  Button,
  Checkbox,
  Label,
  PasswordInput,
  toast,
} from "@repo/design-system";

export function ChangePasswordForm() {
  const tcp = useTranslations("dashboard.changePassword");
  const tc = useTranslations("common");

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(tc("error"));
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
        toast.error(tcp("errorCurrentPassword"));
      } else {
        toast.success(tcp("success"));
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setRevokeOtherSessions(false);
      }
    } catch {
      toast.error(tc("error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="current-password">{tcp("currentPassword")}</Label>
        <PasswordInput
          id="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-password">{tcp("newPassword")}</Label>
        <PasswordInput
          id="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">{tcp("confirmPassword")}</Label>
        <PasswordInput
          id="confirm-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="revoke-sessions"
          checked={revokeOtherSessions}
          onCheckedChange={(checked) => setRevokeOtherSessions(checked === true)}
        />
        <Label htmlFor="revoke-sessions" className="text-sm font-normal">
          {tcp("revokeOtherSessions")}
        </Label>
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? tc("saving") : tcp("cta")}
      </Button>
    </form>
  );
}
