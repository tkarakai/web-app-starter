import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PublicConfigProvider } from "@web-app-starter/design-system";
import messages from "@web-app-starter/i18n/messages/en.json";
import { WaitlistForm } from "../../src/components/waitlist-form";
import { AuthForm } from "../../src/components/auth-form";

// Exercise the async server boundary with Bun (not the DOM/Vitest suite).
// Translation request context is supplied by Next in production.
mock.module("next-intl/server", () => ({ getTranslations: async () => (key: string) => key, getLocale: async () => "en" }));
const originalUrl = process.env.CONVEX_SITE_URL;
const originalCloudUrl = process.env.CONVEX_URL;
process.env.CONVEX_SITE_URL = "https://runtime.example.test";
process.env.CONVEX_URL = "https://cloud.example.test";
const { LandingSignUpView: SignUpView, SignUpView: WebSignUpView, createSignUpView } = await import("@web-app-starter/auth-ui/views");
if (originalCloudUrl === undefined) delete process.env.CONVEX_URL;
else process.env.CONVEX_URL = originalCloudUrl;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.CONVEX_SITE_URL;
  else process.env.CONVEX_SITE_URL = originalUrl;
});

function AppQuestions() { return null; }

test("web selects signup, an inline waitlist and invite-only on consecutive requests", async () => {
  process.env.CONVEX_SITE_URL = "https://runtime.example.test";
  const fetchSpy = spyOn(globalThis, "fetch");
  try {
    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicSignup" }));
    const signup = (await SignUpView()).props.children;
    expect(signup.type).toBe(AuthForm);
    expect(signup.props.mode).toBe("sign-up");

    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicWaitlist" }));
    const waitlist = (await SignUpView()).props.children;
    expect(waitlist.type).toBe(WaitlistForm);
    expect(waitlist.props.convexSiteUrl).toBe("https://runtime.example.test");
    const waitlistHtml = renderToStaticMarkup(createElement(PublicConfigProvider, {
      value: {
        convexUrl: "https://cloud.example.test",
        convexSiteUrl: "https://runtime.example.test",
        landingUrl: "https://landing.example.test",
      },
    }, createElement(NextIntlClientProvider, { locale: "en", messages }, waitlist)));
    expect(waitlistHtml).toContain("<form");
    expect(waitlistHtml).toContain('type="email"');
    expect(waitlistHtml).toContain(messages.auth.waitlist.submit);
    expect(waitlistHtml).toContain('href="https://landing.example.test/en/terms"');
    expect(waitlistHtml).toContain('href="https://landing.example.test/en/privacy"');

    process.env.CONVEX_SITE_URL = "https://next-runtime.example.test";
    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicWaitlist" }));
    const custom = (await createSignUpView({ waitlistForm: AppQuestions })()).props.children;
    expect(custom.type).toBe(AppQuestions);
    expect(custom.props.convexSiteUrl).toBe("https://next-runtime.example.test");

    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "publicWaitlist" }));
    const webWaitlist = (await WebSignUpView()).props.children;
    expect(webWaitlist.type).toBe(WaitlistForm);
    expect(webWaitlist.props.convexSiteUrl).toBe("https://next-runtime.example.test");

    fetchSpy.mockResolvedValueOnce(Response.json({ onboardingType: "inviteOnly" }));
    const closed = (await SignUpView()).props.children as ReactElement;
    const html = renderToStaticMarkup(closed);
    expect(html).toContain('href="/en/sign-in"');
    expect(html).not.toContain("<form");

    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    expect(renderToStaticMarkup((await SignUpView()).props.children)).toBe(html);
  } finally { fetchSpy.mockRestore(); }
});
