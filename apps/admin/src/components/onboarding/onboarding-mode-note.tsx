"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Info } from "lucide-react";

import { api } from "@repo/backend";
import { Alert, AlertTitle } from "@repo/design-system";

function getOnboardingLabel(value: unknown): string {
  if (value === "publicWaitlist" || value === "waitlist") {
    return "Public Waitlist";
  }
  if (value === "publicSignup" || value === "signup") {
    return "Public Self-Signup";
  }
  return "Invite Only";
}

export function OnboardingModeNote() {
  const onboardingType = useQuery(api.appSettings.get, {
    key: "onboardingType",
  });

  const label =
    onboardingType === undefined
      ? "Checking current onboarding mode..."
      : getOnboardingLabel(onboardingType);

  if (onboardingType === undefined) {
    return (
      <Alert className="mt-3">
        <Info className="h-4 w-4" />
        <AlertTitle className="mb-0">{label}</AlertTitle>
      </Alert>
    );
  }

  return (
    <Alert className="mt-3">
      <Info className="h-4 w-4" />
      <AlertTitle className="mb-0">
        Onboarding is currently set to <strong>{label}</strong>.{" "}
        <span className="inline-block w-1.5" aria-hidden="true" />
        <Link
          href="/configure/features#onboarding-feature"
          className="font-normal underline underline-offset-2 hover:text-foreground"
        >
          Change it
        </Link>
      </AlertTitle>
    </Alert>
  );
}
