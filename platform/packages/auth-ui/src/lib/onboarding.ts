/// <reference types="next" />
import { appConfig } from "@web-app-starter/app-config";
/** How new users get in, as the backend's `/api/waitlist/status` route reports it. */
export type OnboardingType = "inviteOnly" | "publicWaitlist" | "publicSignup";

interface WaitlistStatus {
  onboardingType?: OnboardingType | "none" | "waitlist" | "signup";
  waitlistEnabled?: boolean;
  signupEnabled?: boolean;
  enabled?: boolean;
}

/** Normalise the status payload, including the legacy field names older backends send. */
export function parseOnboardingStatus(value: unknown): OnboardingType {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "inviteOnly";
  const data = value as WaitlistStatus;
  if (
    data.onboardingType === "inviteOnly" ||
    data.onboardingType === "publicWaitlist" ||
    data.onboardingType === "publicSignup"
  ) {
    return data.onboardingType;
  }
  if (data.onboardingType === "waitlist") return "publicWaitlist";
  if (data.onboardingType === "signup") return "publicSignup";
  if (data.onboardingType === "none") return "inviteOnly";
  if (data.onboardingType !== undefined) return "inviteOnly";
  if (data.waitlistEnabled === true || data.enabled === true) return "publicWaitlist";
  if (data.signupEnabled === true) return "publicSignup";
  return "inviteOnly";
}

/** A backend cannot enable waitlist UI that the app has explicitly disabled. */
export function configuredOnboardingType(mode: OnboardingType, waitlistEnabled: boolean): OnboardingType {
  return mode === "publicWaitlist" && !waitlistEnabled ? "inviteOnly" : mode;
}

/**
 * Fetch the onboarding mode from Convex (`CONVEX_SITE_URL`, read at request time), uncached
 * so admin changes apply on the next request. Fail closed on backend errors.
 */
export async function fetchOnboardingType(): Promise<OnboardingType> {
  const convexSiteUrl = process.env.CONVEX_SITE_URL;
  if (!convexSiteUrl) {
    throw new Error("Missing required environment variable: CONVEX_SITE_URL");
  }
  try {
    const res = await fetch(`${convexSiteUrl}/api/waitlist/status`, {
      cache: "no-store",
    });
    if (!res.ok) return "inviteOnly";
    return configuredOnboardingType(
      parseOnboardingStatus((await res.json()) as WaitlistStatus),
      appConfig.features.waitlist,
    );
  } catch {
    return "inviteOnly";
  }
}
