import { expect, test } from "@playwright/test";
import { getLocaleDirection, locales } from "@web-app-starter/i18n";

import { sessionBackButton, sessionBackLabel } from "./helpers/session-navigation";

// Browser-only regression: no authentication, application server or backend needed.
for (const locale of locales) {
  for (const collision of ["containing", "equal"] as const) {
    test(`${locale} session back control ignores ${collision}-label product name collisions`, async ({ page }) => {
      const backLabel = sessionBackLabel(locale);
      const productName = collision === "equal" ? backLabel : `Dashboard Projects Settings ${backLabel} Workspace`;

      await page.setContent(`
        <aside><button type="button" id="product-logo"></button></aside>
        <main>
          <button type="button" id="back-to-dashboard">
            <svg aria-hidden="true" width="14" height="14"></svg><span></span>
          </button>
          <output></output>
        </main>
      `);
      await page.evaluate(({ locale, direction, productName, backLabel }) => {
        document.documentElement.lang = locale;
        document.documentElement.dir = direction;
        const logo = document.querySelector<HTMLButtonElement>("#product-logo")!;
        const back = document.querySelector<HTMLButtonElement>("#back-to-dashboard")!;
        const output = document.querySelector("output")!;
        logo.textContent = productName;
        back.querySelector("span")!.textContent = backLabel;
        logo.onclick = () => { output.textContent = "logo"; };
        back.onclick = () => { output.textContent = "dashboard"; };
      }, { locale, direction: getLocaleDirection(locale), productName, backLabel });

      await expect(page.getByRole("complementary").getByRole("button", { name: productName, exact: true })).toBeVisible();
      const backButton = sessionBackButton(page, locale);
      await expect(backButton).toHaveCount(1);
      await expect(backButton).toHaveAttribute("id", "back-to-dashboard");
      await backButton.click();
      await expect(page.locator("output")).toHaveText("dashboard");
    });
  }
}
