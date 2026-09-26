import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import arabic from "@web-app-starter/i18n/messages/ar.json";
import french from "@web-app-starter/i18n/messages/fr.json";
import { PasswordInput, CopyableField, PasskeyUnsupportedAlert, OtpInput, TimezoneSelector, Breadcrumb } from "@/components/ui/localized-controls";
import { DeadlineInput } from "@/components/projects/deadline-input";

describe("localized shared controls", () => {
  it("uses the active catalog for password, clipboard and unsupported-passkey text", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={arabic}>
        <PasswordInput aria-label="password" />
        <CopyableField value="example" />
        <PasskeyUnsupportedAlert />
        <Breadcrumb />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: arabic.common.showPassword }));
    expect(screen.getByLabelText("password")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: arabic.common.hidePassword })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: arabic.common.copy })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: arabic.common.breadcrumb })).toBeInTheDocument();
    expect(screen.getByText(arabic.dashboard.passkeys.unsupportedTitle)).toBeInTheDocument();
    expect(screen.queryByText("Passkeys aren't supported on this device or browser.")).not.toBeInTheDocument();
  });

  it("localizes each OTP digit and preserves the field label", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={arabic}>
        <OtpInput value="" onChange={() => {}} aria-label={arabic.auth.twoFactorVerify.title} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("group", { name: arabic.auth.twoFactorVerify.title })).toBeInTheDocument();
    expect(screen.getByLabelText(arabic.common.otpDigit.replace("{index}", "1").replace("{length}", "6"))).toBeInTheDocument();
  });

  it("localizes timezone names and calendar navigation", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={french}>
        <TimezoneSelector value="Europe/London" onValueChange={() => {}} />
        <DeadlineInput value={undefined} onChange={() => {}} timeZone="Europe/London" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("combobox", { name: /^Londres \(/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: french.tasks.fields.deadlinePlaceholder }));
    expect(screen.getByRole("button", { name: french.common.previousMonth })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: french.common.nextMonth })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: french.common.hour })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: french.common.minute })).toBeInTheDocument();
  });
});
