"use client";

import { usePasswordStrength } from "@web-app-starter/auth-ui";
import { translatePasswordStrength as t } from "@web-app-starter/i18n/password-strength";

import { useAction } from "convex/react";
import { api } from "@repo/backend";
import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { authClient, formatAuthError, isConvexRateLimited, AUTH_RATE_LIMIT_MESSAGE } from "@web-app-starter/auth/client";
import {
  Button,
  Input,
  Label,
  PasswordInput,
} from "@web-app-starter/design-system";
import {
  PasswordStrengthMeter,
  getMinPasswordLength,
} from "@web-app-starter/design-system/password-strength";

interface CreateAccountStepProps {
  email: string;
  onBeforeSignUp: () => Promise<string>;
  onComplete: (password: string) => Promise<void>;
  onBack: () => void;
}

export function CreateAccountStep({ email, onBeforeSignUp, onComplete, onBack }: CreateAccountStepProps) {
  const register = useAction(api.platform.adminInvitations.register);
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { result: strengthResult, valid: isPasswordValid } = usePasswordStrength(
    password,
    { email, role: "admin" },
  );

  const passwordsMatch = password === confirmPassword;
  const canSubmit = name.trim() && isPasswordValid && passwordsMatch && !loading;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);

    try {
      const capability = await onBeforeSignUp();
      await register({ capability, name: name.trim(), email, password });
      const result = await authClient.signIn.email({ email, password });

      if (result.error) {
        const msg = formatAuthError(result.error, "Failed to create account");
        setError(msg);
        return;
      }

      await onComplete(password);
    } catch (err) {
      if (isConvexRateLimited(err)) {
        setError(AUTH_RATE_LIMIT_MESSAGE);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="onboarding-email">Email</Label>
        <Input
          id="onboarding-email"
          type="email"
          value={email}
          disabled
          className="bg-muted"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-name">Name</Label>
        <Input
          id="onboarding-name"
          type="text"
          placeholder="Your full name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-password">Password</Label>
        <PasswordInput
          id="onboarding-password"
          placeholder={t("minLength", { count: getMinPasswordLength("admin") })}
          value={password}
          minLength={getMinPasswordLength("admin")}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <PasswordStrengthMeter result={strengthResult} password={password} t={t} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-confirm-password">Confirm password</Label>
        <PasswordInput
          id="onboarding-confirm-password"
          placeholder="Re-enter your password"
          value={confirmPassword}
          minLength={getMinPasswordLength("admin")}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
        {confirmPassword && !passwordsMatch ? (
          <p className="text-xs text-destructive">Passwords do not match.</p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Button className="w-full" type="submit" disabled={!canSubmit}>
        {loading ? "Creating account..." : "Create account"}
      </Button>
      <Button
        className="w-full"
        type="button"
        variant="ghost"
        disabled={loading}
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to intro
      </Button>
    </form>
  );
}
