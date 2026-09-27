/// <reference types="next" />
/** How new users get in, as the backend's `/api/waitlist/status` route reports it. */
export type OnboardingType = "inviteOnly" | "publicWaitlist" | "publicSignup";

interface WaitlistStatus {
  onboardingType?: OnboardingType | "none" | "waitlist" | "signup";
  waitlistEnabled?: boolean;
  signupEnabled?: boolean;
  enabled?: boolean;
}

/** Normalise the status payload, including the legacy field names older backends send. */
export function parseOnboardingStatus(data: WaitlistStatus): OnboardingType {
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
  if (data.waitlistEnabled === true || data.enabled === true) return "publicWaitlist";
  if (data.signupEnabled === true) return "publicSignup";
  return "publicSignup";
}

/**
 * Fetch the onboarding mode from Convex (`CONVEX_SITE_URL`, read at request time), cached
 * for a minute. Falls back to public sign-up if the backend can't be reached.
 */
export async function fetchOnboardingType(): Promise<OnboardingType> {
  const convexSiteUrl = process.env.CONVEX_SITE_URL;
  if (!convexSiteUrl) {
    throw new Error("Missing required environment variable: CONVEX_SITE_URL");
  }
  try {
    const res = await fetch(`${convexSiteUrl}/api/waitlist/status`, {
      next: { revalidate: 60 },
    });
    return parseOnboardingStatus((await res.json()) as WaitlistStatus);
  } catch {
    return "publicSignup";
  }
}
