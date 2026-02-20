export const ONBOARDING_TYPES = ["none", "waitlist", "signup"] as const;

export type OnboardingType = (typeof ONBOARDING_TYPES)[number];

export const DEFAULT_ONBOARDING_TYPE: OnboardingType = "none";

export function isOnboardingType(value: string): value is OnboardingType {
  return (ONBOARDING_TYPES as readonly string[]).includes(value);
}

export function parseOnboardingType(value: unknown): OnboardingType {
  if (typeof value === "string" && isOnboardingType(value)) {
    return value;
  }
  return DEFAULT_ONBOARDING_TYPE;
}

export function isWaitlistOnboarding(value: OnboardingType): boolean {
  return value === "waitlist";
}

export function isSignupOnboarding(value: OnboardingType): boolean {
  return value === "signup";
}
