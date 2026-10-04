import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import platform from "@web-app-starter/i18n/messages/en.json";
import app from "@repo/messages/en.json";
import { WaitlistForm } from "../../src/components/waitlist-form";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test("landing uses the shared form with build-time URLs and accepts email only", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://landing-backend.example.test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://landing.example.test");
  const fetch = vi.fn().mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal("fetch", fetch);
  render(<NextIntlClientProvider locale="hu" messages={{ ...platform, ...app }}><WaitlistForm /></NextIntlClientProvider>);
  expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "https://landing.example.test/hu/terms");
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Anna@Example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
  await screen.findByText("You're on the list!");
  expect(fetch.mock.calls[0][0]).toBe("https://landing-backend.example.test/api/waitlist/join");
  expect(JSON.parse(fetch.mock.calls[0][1].body).email).toBe("anna@example.test");
});
