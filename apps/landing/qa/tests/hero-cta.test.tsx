import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@repo/messages/en.json";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
test("hands off to web without a backend URL or requests", async () => {
  vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://web.example.test");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", undefined);
  const fetch = vi.fn(() => { throw Error("Landing must not fetch onboarding"); });
  vi.stubGlobal("fetch", fetch);
  const { HeroCta } = await import("../../src/components/hero-cta");
  render(<NextIntlClientProvider locale="en" messages={messages}><HeroCta /></NextIntlClientProvider>);
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "https://web.example.test/sign-up");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "https://web.example.test/sign-in");
  expect(fetch).not.toHaveBeenCalled();
});
