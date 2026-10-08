import { afterEach, expect, test, spyOn } from "bun:test";
import { appConfig } from "@web-app-starter/app-config";
import { configuredOnboardingType, fetchOnboardingType, parseOnboardingStatus } from "../../src/lib/onboarding";

const originalUrl = process.env.CONVEX_SITE_URL;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.CONVEX_SITE_URL;
  else process.env.CONVEX_SITE_URL = originalUrl;
});

test("each onboarding decision fetches current mode without Next's data cache", async () => {
  process.env.CONVEX_SITE_URL = "https://backend.example.test";
  const fetchSpy = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ onboardingType: "publicSignup" }))
    .mockResolvedValueOnce(Response.json({ onboardingType: "publicWaitlist" }));
  try {
    expect(await fetchOnboardingType()).toBe("publicSignup");
    expect(await fetchOnboardingType()).toBe(appConfig.features.waitlist ? "publicWaitlist" : "inviteOnly");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith("https://backend.example.test/api/waitlist/status", { cache: "no-store" });
  } finally { fetchSpy.mockRestore(); }
});

test("status failures and malformed responses fail closed", async () => {
  process.env.CONVEX_SITE_URL = "https://backend.example.test";
  const fetchSpy = spyOn(globalThis, "fetch");
  try {
    for (const response of [Response.json({ onboardingType: "publicSignup" }, { status: 503 }), Response.json({}), Response.json(null), new Response("invalid")]) {
      fetchSpy.mockResolvedValueOnce(response);
      expect(await fetchOnboardingType()).toBe("inviteOnly");
    }
    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchOnboardingType()).toBe("inviteOnly");
  } finally { fetchSpy.mockRestore(); }
});

test("disabled waitlist stays closed for every supported backend status shape", () => {
  for (const payload of [
    { onboardingType: "publicWaitlist" },
    { onboardingType: "waitlist" },
    { waitlistEnabled: true },
    { enabled: true },
  ]) {
    const mode = parseOnboardingStatus(payload);
    expect(configuredOnboardingType(mode, false)).toBe("inviteOnly");
    expect(configuredOnboardingType(mode, true)).toBe("publicWaitlist");
  }
  for (const enabled of [false, true]) {
    expect(configuredOnboardingType("publicSignup", enabled)).toBe("publicSignup");
    expect(configuredOnboardingType("inviteOnly", enabled)).toBe("inviteOnly");
  }
});

test("legacy explicit statuses remain supported, unknown mode never opens signup", () => {
  expect(parseOnboardingStatus({ onboardingType: "none", signupEnabled: true })).toBe("inviteOnly");
  expect(parseOnboardingStatus({ onboardingType: "waitlist" })).toBe("publicWaitlist");
  expect(parseOnboardingStatus({ signupEnabled: true })).toBe("publicSignup");
  expect(parseOnboardingStatus({})).toBe("inviteOnly");
  expect(parseOnboardingStatus({ onboardingType: "unknown", signupEnabled: true })).toBe("inviteOnly");
});
