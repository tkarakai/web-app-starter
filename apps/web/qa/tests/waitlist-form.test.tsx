import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PublicConfigProvider } from "@web-app-starter/design-system";
import platform from "@web-app-starter/i18n/messages/en.json";
import app from "@repo/messages/en.json";
import { AppWaitlistForm } from "../../src/components/waitlist-form";

afterEach(() => vi.unstubAllGlobals());
test("email alone joins without answering sample questions", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, alreadyJoined: true }));
  vi.stubGlobal("fetch", fetch);
  render(<PublicConfigProvider value={{ convexUrl: "https://cloud.example.test", convexSiteUrl: "https://runtime.example.test", landingUrl: "https://landing.example.test" }}>
    <NextIntlClientProvider locale="en" messages={{ ...platform, ...app }}>
      <AppWaitlistForm convexSiteUrl="https://runtime.example.test" />
    </NextIntlClientProvider>
  </PublicConfigProvider>);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Anna@Example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
  await screen.findByText("You're on the list!");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: "anna@example.test", meta: JSON.stringify({ superpowers: [], excitement: [] }) });
});
