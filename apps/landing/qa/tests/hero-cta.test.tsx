import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import appMessages from "@repo/messages/en.json";
import platformMessages from "@web-app-starter/i18n/messages/en.json";
import type { ComponentProps } from "react";
import { appConfig } from "@web-app-starter/app-config";
const messages = { ...platformMessages, ...appMessages };
vi.mock("@web-app-starter/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => <a {...props} /> }));
const featureOverride = vi.hoisted(() => ({ waitlist: null as boolean | null }));
vi.mock("@web-app-starter/app-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@web-app-starter/app-config")>();
  return {
    ...original,
    appConfig: {
      ...original.appConfig,
      features: {
        ...original.appConfig.features,
        get waitlist() { return featureOverride.waitlist ?? original.appConfig.features.waitlist; },
      },
    },
  };
});

vi.stubEnv("NEXT_PUBLIC_WEB_APP_URL", "https://web.example.test/");
vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://backend.example.test");
vi.stubEnv("NEXT_PUBLIC_BOOK_DEMO_URL", "https://demo.example.test");
vi.stubEnv("NEXT_PUBLIC_CONTACT_URL", "mailto:team@example.test");
const { HeroCta } = await import("../../src/components/hero-cta");
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  featureOverride.waitlist = null;
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://backend.example.test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const show = () => render(<NextIntlClientProvider locale="en" messages={messages}><HeroCta /></NextIntlClientProvider>);

test("waits for backend mode without prematurely offering signup", async () => {
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise(r => { resolve = r; }));
  show();
  expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
  await act(async () => resolve(Response.json({ onboardingType: "publicSignup" })));
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "https://web.example.test/en/sign-up");
  expect(fetchMock).toHaveBeenCalledWith("https://backend.example.test/api/waitlist/status", expect.objectContaining({ cache: "no-store" }));
});

async function expectWaitlistMode(enabled: boolean) {
  fetchMock.mockResolvedValue(Response.json({ onboardingType: "publicWaitlist" }));
  show();
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "https://web.example.test/en/sign-in");
  if (enabled) {
    expect(screen.getByLabelText(messages.landing.waitlist.emailLabel)).toBeVisible();
    expect(screen.getByLabelText(messages.landing.waitlist.companyLabel)).toBeVisible();
  } else {
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: messages.landing.waitlist.submit })).toBeNull();
  }
  expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
}

test("waitlist mode respects the adopted app's configured feature switch", async () => {
  await expectWaitlistMode(appConfig.features.waitlist);
});

test.each([true, false])("backend publicWaitlist respects features.waitlist=%s", async (enabled) => {
  featureOverride.waitlist = enabled;
  await expectWaitlistMode(enabled);
});

for (const payload of [{ onboardingType: "inviteOnly" }, { onboardingType: "unknown", signupEnabled: true }, null]) {
  test(`closes registration for ${JSON.stringify(payload)}`, async () => {
    fetchMock.mockResolvedValue(Response.json(payload));
    show();
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
}

test("HTTP failure offers fallback links and a retry recovers to signup", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(new Response("offline", { status: 503 })).mockResolvedValue(Response.json({ onboardingType: "publicSignup" }));
  await act(async () => { show(); });
  expect(screen.getByText(messages.landing.fallback.title)).toBeVisible();
  expect(screen.getByRole("link", { name: messages.landing.fallback.bookDemo })).toHaveAttribute("href", "https://demo.example.test");
  expect(screen.getByRole("link", { name: messages.landing.fallback.contact })).toHaveAttribute("href", "mailto:team@example.test");
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(screen.getByRole("link", { name: "Get started" })).toBeVisible();
  expect(screen.queryByText(messages.landing.fallback.title)).toBeNull();
});

test("returning to the tab refreshes the mode without overlapping requests", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ onboardingType: "publicSignup" })).mockResolvedValue(Response.json({ onboardingType: "inviteOnly" }));
  show();
  await screen.findByRole("link", { name: "Get started" });
  await act(async () => { fireEvent(document, new Event("visibilitychange")); });
  expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("unmount aborts in-flight requests and removes retry timers", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new window.DOMException("Aborted", "AbortError")));
  }));
  const view = show();
  const signal = fetchMock.mock.calls[0][1]?.signal;
  await act(async () => view.unmount());
  expect(signal?.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
