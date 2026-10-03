import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WaitlistForm } from "../../src/components/waitlist-form";
import { AuthForm } from "../../src/components/auth-form";

// Exercise the async server boundary with Bun (not the DOM/Vitest suite).
// Translation request context is supplied by Next in production.
mock.module("next-intl/server", () => ({ getTranslations: async () => (key: string) => key, getLocale: async () => "en" }));
const originalUrl = process.env.CONVEX_SITE_URL;
const originalCloudUrl = process.env.CONVEX_URL;
process.env.CONVEX_SITE_URL = "https://runtime.example.test";
process.env.CONVEX_URL = "https://cloud.example.test";
process.env.LANDING_URL = "https://landing.example.test/";
const { LandingSignUpView: SignUpView, SignUpView: WebSignUpView, createSignUpView } = await import("@web-app-starter/auth-ui/views");
if (originalCloudUrl === undefined) delete process.env.CONVEX_URL;
else process.env.CONVEX_URL = originalCloudUrl;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.CONVEX_SITE_URL;
  else process.env.CONVEX_SITE_URL = originalUrl;
});

function AppQuestions() { return null; }

test("web selects signup, a localized landing waitlist link and invite-only on consecutive requests", async () => {
  process.env.CONVEX_SITE_URL = "https://runtime.example.test";
  const fetchSpy = spyOn(globalThis, "fetch");
  try {
    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicSignup" }));
    const signup = (await SignUpView()).props.children;
    expect(signup.type).toBe(AuthForm);
    expect(signup.props.mode).toBe("sign-up");

    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicWaitlist" }));
    const waitlist = (await SignUpView()).props.children;
    const waitlistHtml = renderToStaticMarkup(waitlist);
    expect(waitlistHtml).toContain('href="https://landing.example.test/en/"');
    expect(waitlistHtml).toContain("goToWaitlist");
    expect(waitlistHtml).not.toContain("<form");

    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicWaitlist" }));
    const custom = (await createSignUpView({ waitlistForm: AppQuestions })()).props.children;
    expect(custom.type).toBe(AppQuestions);
    expect(custom.props.convexSiteUrl).toBe("https://runtime.example.test");

    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicWaitlist" }));
    expect((await WebSignUpView()).props.children.type).toBe(WaitlistForm);

    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "inviteOnly" }));
    const closed = (await SignUpView()).props.children as ReactElement;
    const html = renderToStaticMarkup(closed);
    expect(html).toContain('href="/en/sign-in"');
    expect(html).not.toContain("<form");

    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    expect(renderToStaticMarkup((await SignUpView()).props.children)).toBe(html);
  } finally { fetchSpy.mockRestore(); }
});
