import { test as base, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@repo/backend";
import { createDisposableUser, localConvexUrl } from "./fixtures";

type OnboardingType = "inviteOnly" | "publicWaitlist" | "publicSignup";

interface OnboardingFixture {
  client: ConvexHttpClient;
  setMode: (mode: OnboardingType) => Promise<void>;
}

/**
 * Admin settings survive launcher restarts. Tests must select their policy
 * explicitly, then restore the effective previous policy even on failure.
 * The API request fixture has its own cookies; the browser remains a guest.
 */
export const test = base.extend<{ onboarding: OnboardingFixture }>({
  onboarding: async ({ request }, runFixture, testInfo) => {
    if (testInfo.config.workers !== 1) {
      throw new Error("Onboarding fixtures change shared policy; run with CI=true or --workers=1.");
    }
    const client = new ConvexHttpClient(localConvexUrl());
    const admin = await createDisposableUser({ isAdmin: true });
    const signedIn = await request.post("/api/auth/sign-in/email", {
      data: admin,
      headers: { Origin: new URL(testInfo.project.use.baseURL!).origin },
    });
    expect(signedIn.ok(), `Fixture admin sign-in returned HTTP ${signedIn.status()}`).toBe(true);
    const tokenResponse = await request.get("/api/auth/convex/token");
    expect(tokenResponse.ok(), `Fixture token request returned HTTP ${tokenResponse.status()}`).toBe(true);
    const { token } = await tokenResponse.json() as { token: string };
    client.setAuth(token);
    const previous = await client.query(api.platform.appSettings.get, { key: "onboardingType" });
    if (previous !== "inviteOnly" && previous !== "publicWaitlist" && previous !== "publicSignup") {
      throw new Error(`Unexpected onboarding policy: ${String(previous)}`);
    }
    const setMode = async (mode: OnboardingType) => {
      await client.mutation(api.platform.appSettings.set, { key: "onboardingType", value: mode });
    };
    try {
      await runFixture({ client, setMode });
    } finally {
      await setMode(previous);
    }
  },
});

export { expect };
