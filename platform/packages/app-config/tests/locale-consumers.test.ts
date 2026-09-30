import { expect, test } from "bun:test";
import { spawn } from "bun";

// Module mocking is isolated so the other tests retain their real app config.
test("a Hungarian default reaches routing, message fallback and SEO without reordering locales", async () => {
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    import raw from "../../../../app.config.ts";
    import { validateAppConfig } from "../src/schema.ts";
    const appConfig = validateAppConfig({ ...raw, i18n: { locales: ["en", "hu"], defaultLocale: "hu" } });
    mock.module("@web-app-starter/app-config", () => ({ appConfig }));
    mock.module("@repo/messages", () => ({
      appMessages: { hu: async () => ({ sample: { fallback: "magyar" } }) }, appOverrides: {},
    }));
    const { locales, defaultLocale } = await import("../../i18n/src/config.ts");
    assert.deepEqual(locales, ["en", "hu"]);
    assert.equal(defaultLocale, "hu");
    const { loadMessages } = await import("../../i18n/src/messages.ts");
    assert.equal((await loadMessages("en")).sample.fallback, "magyar");
    const { HreflangLinks } = await import("../../i18n/src/hreflang.tsx");
    const links = HreflangLinks({ locale: "en", pathname: "/", siteUrl: "https://example.com" });
    assert.equal(links.props.children[1].props.href, "https://example.com/hu");
  `;
  const child = spawn(["bun", "-e", script], { cwd: new URL(".", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
});
