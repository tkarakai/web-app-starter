import { expect, test } from "@playwright/test";
import { locales } from "@web-app-starter/i18n";
import { createTranslator } from "next-intl";

import { loadE2EMessages } from "./helpers/locale-messages";

// Exercise catalogue loading in real Playwright Node workers without a backend.
for (const locale of locales) {
  test(`${locale}: waitlist and invitation labels load in Playwright`, async () => {
    const messages = loadE2EMessages(locale);
    const signIn = createTranslator({ locale, messages, namespace: "auth.signIn" });
    const invitation = createTranslator({ locale, messages, namespace: "auth.invitation" });
    expect(signIn("switchPrompt")).toBe(messages.auth.signIn.switchPrompt);
    expect(signIn("switchLink")).toBe(messages.auth.signIn.switchLink);
    expect(invitation("signupBlocked")).toBe(messages.auth.invitation.signupBlocked);
  });
}
