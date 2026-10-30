"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@web-app-starter/design-system";

type Scope = "admin" | "user";
type PasskeyPolicy = "disabled" | "optional" | "required";

const SETTINGS_KEY: Record<Scope, string> = {
  user: "userPasskeyPolicy",
  admin: "adminPasskeyPolicy",
};

function normalizePolicy(value: unknown): PasskeyPolicy {
  return value === "disabled" || value === "required" ? value : "optional";
}

export function PasskeyPolicyCard({ scope }: { scope: Scope }) {
  const isAdminScope = scope === "admin";
  const audience = isAdminScope ? "app operators and organization administrators" : "regular users";
  const key = SETTINGS_KEY[scope];
  const policyRaw = useQuery(api.platform.appSettings.get, { key });
  const setSetting = useMutation(api.platform.appSettings.set);
  const [saving, setSaving] = React.useState(false);

  const isLoading = policyRaw === undefined;
  const policy = normalizePolicy(policyRaw);

  const updatePolicy = async (nextValue: PasskeyPolicy) => {
    setSaving(true);
    try {
      await setSetting({ key, value: nextValue });
      toast.success(`Passkey policy updated for ${audience}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message.includes("SECURITY_POLICY_ORGANIZATION_LIMIT")
        ? "The current policy is unchanged. Requiring passkeys across more than 1,000 active membership-managed organizations needs a reviewed staged transition. Contact your deployment maintainer."
        : message.includes("LAST_ORGANIZATION_ADMIN")
          ? "The current policy is unchanged. Each active organization must have an eligible administrator with a passkey before passkeys can be required."
          : "Failed to update passkey policy. Refresh your session and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">
              {isAdminScope ? "Administrator Passkey Policy" : "User Passkey Policy"}
            </CardTitle>
            <CardDescription>
              {isAdminScope
                ? "Configure passkey requirements for app operators and organization administrators."
                : "Configure passkey requirements for regular users."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-10 w-56" />
          </>
        ) : (
          <>
            <div className="space-y-2 max-w-xs">
              <Label htmlFor={`${scope}-passkey-policy`}>Policy</Label>
              <Select
                value={policy}
                onValueChange={(value) => void updatePolicy(value as PasskeyPolicy)}
                disabled={saving}
              >
                <SelectTrigger id={`${scope}-passkey-policy`}>
                  <SelectValue placeholder="Select policy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="optional">Optional</SelectItem>
                  <SelectItem value="required">Required</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              {policy === "disabled"
                ? `Passkeys are unavailable for ${audience}.`
                : policy === "required"
                ? `Passkeys are mandatory for ${audience} (initial setup is allowed for users without passkeys).`
                : `Passkeys are optional for ${audience}.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
