"use client";

import * as React from "react";
import Link from "next/link";

import { authClient, formatAuthError } from "@repo/auth/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  PasswordInput,
} from "@repo/design-system";

function formatResetError(error: { status?: number; message?: string }): string {
  if (
    error.message?.includes("INVALID_TOKEN") ||
    error.message?.includes("expired")
  ) {
    return "This reset link has expired or is invalid. Please request a new one.";
  }
  return formatAuthError(error, "Something went wrong. Please try again.");
}

export function AdminResetPasswordForm({
  token,
  error: urlError,
}: {
  token?: string;
  error?: string;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [success, setSuccess] = React.useState(false);

  // No token — show invalid state
  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            Invalid reset link
          </CardTitle>
          <CardDescription>
            {urlError === "EXPIRED"
              ? "This reset link has expired. Please request a new one."
              : "This reset link is invalid or has already been used."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button className="w-full" asChild>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Success state
  if (success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            Password reset
          </CardTitle>
          <CardDescription>
            Your password has been successfully reset. You can now sign in with
            your new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" asChild>
            <Link href="/sign-in">Sign in now</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);

    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });

      if (result.error) {
        setError(formatResetError(result.error));
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          Reset password
        </CardTitle>
        <CardDescription>Enter your new password below.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              name="new-password"
              placeholder="Enter new password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={40}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm password</Label>
            <PasswordInput
              id="confirm-new-password"
              name="confirm-new-password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={40}
            />
          </div>
          {error ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Resetting..." : "Reset password"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" asChild>
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
