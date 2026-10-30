import { describe, expect, it } from "bun:test";
import { allLocales } from "@web-app-starter/i18n";
import { counts, validateReport } from "../../../../platform/tooling/e2e/secret-safe-report";
import { runConfiguredWeb, type WebConfigurationVariant } from "./helpers/web-configuration";

interface DiscoveredSuite {
  title: string;
  suites?: DiscoveredSuite[];
  specs?: Array<{ title: string; tests: Array<{ annotations: Array<{ type: string }> }> }>;
}

const variants: Array<{ name: string; waitlistLocales: string[] } & WebConfigurationVariant> = [
  { name: "full locale set, enabled", i18n: { locales: [...allLocales] }, waitlist: true, waitlistLocales: ["en", "cs"] },
  { name: "full locale set, disabled", i18n: { locales: [...allLocales] }, waitlist: false, waitlistLocales: ["en", "cs"] },
  { name: "English only, enabled", i18n: { locales: ["en"] }, waitlist: true, waitlistLocales: ["en"] },
  { name: "English only, disabled", i18n: { locales: ["en"] }, waitlist: false, waitlistLocales: ["en"] },
  { name: "Hungarian default, enabled", i18n: { locales: ["en", "hu"], defaultLocale: "hu" }, waitlist: true, waitlistLocales: ["hu", "en"] },
  { name: "Hungarian default, disabled", i18n: { locales: ["en", "hu"], defaultLocale: "hu" }, waitlist: false, waitlistLocales: ["hu", "en"] },
];

describe("retained web tests follow app configuration", () => {
  for (const variant of variants) {
    it(`${variant.name}: real middleware assertions pass`, async () => {
      const result = await runConfiguredWeb(variant, "middleware");
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toContain(`${variant.i18n.locales.length * 16 + 4} pass`);
      expect(result.stderr).toContain("0 fail");
    }, 15_000);

    it(`${variant.name}: fetched onboarding policy respects the waitlist switch`, async () => {
      const result = await runConfiguredWeb(variant, "onboarding");
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toContain("4 pass");
      expect(result.stderr).toContain("0 fail");
    }, 15_000);

    it(`${variant.name}: retained waitlist E2E selects configured locales and coverage`, async () => {
      const result = await runConfiguredWeb(variant, "discovery");
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout) as { suites: DiscoveredSuite[]; errors: unknown[] };
      expect(report.errors).toEqual([]);
      const suites = report.suites.flatMap(suite => suite.suites ?? []);
      expect(suites.map(suite => suite.title)).toEqual(variant.waitlistLocales.map(locale => `configured waitlist sign-up: ${locale}`));
      for (const suite of suites) {
        expect(suite.specs?.map(spec => spec.title)).toEqual([
          variant.waitlist
            ? "sign-in → sign-up accepts waitlist email inline"
            : "disabled waitlist stays closed under publicWaitlist policy",
          "sign-up respects publicSignup and inviteOnly mode changes",
        ]);
        // Disabling the feature replaces the positive flow with active fail-closed
        // coverage; the complete spec must never be skipped.
        for (const spec of suite.specs ?? []) {
          expect(spec.tests.every(test => !test.annotations.some(annotation => annotation.type === "skip"))).toBe(true);
        }
      }
    }, 15_000);

    it(`${variant.name}: translators execute in real Playwright Node workers`, async () => {
      const result = await runConfiguredWeb(variant, "translations");
      expect(result.code, result.stderr).toBe(0);
      const report = validateReport(JSON.parse(result.stdout));
      expect(report.status).toBe("passed");
      expect(report.globalErrors).toEqual([]);
      expect(counts(report)).toEqual({
        tests: variant.i18n.locales.length, attempts: variant.i18n.locales.length,
        passed: variant.i18n.locales.length, unexpected: 0, skipped: 0, flaky: 0,
        failed: 0, timedOut: 0, interrupted: 0, retries: 0,
      });
    }, 15_000);
  }
});
