import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@web-app-starter/i18n/messages/en.json";
import { PublicConfigProvider } from "@web-app-starter/design-system";
import { WaitlistForm } from "../../src/components/waitlist-form";

afterEach(() => vi.unstubAllGlobals());
const config = { convexUrl: "https://cloud.example.test", convexSiteUrl: "https://runtime.example.test", landingUrl: "https://marketing.example.test" };
const endpoint = "https://runtime.example.test";
function form(meta?: Record<string, string | number | boolean | null | string[]>) {
  render(<PublicConfigProvider value={config}><NextIntlClientProvider locale="en" messages={messages}>
    <WaitlistForm convexSiteUrl={endpoint} meta={meta}><label>Custom question<input name="custom" /></label></WaitlistForm>
  </NextIntlClientProvider></PublicConfigProvider>);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ANNA@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
}

test.each([undefined, { custom: true, teamSize: 3, interests: ["art"] }])("posts optional arbitrary JSON directly to the runtime backend (%j)", async (meta) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, alreadyJoined: false }));
  vi.stubGlobal("fetch", fetch);
  form(meta);
  await screen.findByText("You're on the list!");
  expect(fetch).toHaveBeenCalledWith(`${endpoint}/api/waitlist/join`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "anna@example.test", meta: JSON.stringify(meta ?? {}) }),
  });
});

test.each([
  ["INVALID_EMAIL", "Please enter a valid email address."],
  ["WAITLIST_NOT_ENABLED", messages.auth.waitlist.errors.waitlistNotEnabled],
  ["RATE_LIMITED", messages.auth.waitlist.errors.rateLimited],
  ["INVALID_META", messages.auth.waitlist.errors.generic],
])("shows stable feedback for %s and allows retry", async (error, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error }, { status: 400 })));
  form();
  await screen.findByText(message);
  expect(screen.queryByText("You're on the list!")).toBeNull();
  expect(screen.getByRole("button", { name: "Join waitlist" })).toBeEnabled();
});

test("network failure releases pending state; a duplicate join is success", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ success: true, alreadyJoined: true }));
  vi.stubGlobal("fetch", fetch);
  form();
  await screen.findByText(messages.auth.waitlist.errors.generic);
  fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
  await screen.findByText("You're on the list!");
});

test("app validation can disable submission and pending prevents repeated submission", async () => {
  const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetch);
  const wrap = (disabled: boolean) => <PublicConfigProvider value={config}><NextIntlClientProvider locale="en" messages={messages}><WaitlistForm convexSiteUrl={endpoint} disabled={disabled} /></NextIntlClientProvider></PublicConfigProvider>;
  const { rerender } = render(wrap(true));
  expect(screen.getByRole("button", { name: "Join waitlist" })).toBeDisabled();
  rerender(wrap(false));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anna@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Joining..." })).toBeDisabled());
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("legal links use the runtime marketing origin and current locale", () => {
  render(<PublicConfigProvider value={config}><NextIntlClientProvider locale="hu" messages={messages}>
    <WaitlistForm convexSiteUrl={endpoint} />
  </NextIntlClientProvider></PublicConfigProvider>);
  expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "https://marketing.example.test/hu/terms");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "https://marketing.example.test/hu/privacy");
});
