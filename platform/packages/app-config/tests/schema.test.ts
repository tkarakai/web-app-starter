import { describe, expect, it } from "bun:test";

import rawAppConfig from "../../../../app.config";
import { appConfig, localAppOrigin } from "../src/index";
import {
  APP_IDS,
  AppConfigError,
  localOrigin,
  tokenOverrideCss,
  validateAppConfig,
  type AppConfig,
} from "../src/schema";

/** A deep copy of the checked-in config, as plain data, to mutate per test. */
function draft(): Record<string, unknown> & AppConfig {
  return JSON.parse(JSON.stringify(rawAppConfig)) as Record<string, unknown> & AppConfig;
}

function issuesOf(input: unknown): readonly string[] {
  try {
    validateAppConfig(input);
  } catch (error) {
    if (error instanceof AppConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe("app.config.ts", () => {
  it("is valid as checked in", () => {
    expect(issuesOf(rawAppConfig)).toEqual([]);
    expect(appConfig).toEqual(validateAppConfig(rawAppConfig));
  });

  it("gives every app a port", () => {
    for (const app of APP_IDS) expect(appConfig.runtime.ports[app]).toBeGreaterThan(1023);
  });

  it("derives local origins from the ports", () => {
    expect(localAppOrigin("web")).toBe(`http://localhost:${appConfig.runtime.ports.web}`);
  });
});

describe("validateAppConfig", () => {
  it("accepts a fully customised config", () => {
    const config = draft();
    config.identity.productName = "Acme Cloud";
    config.identity.legalEntity = "Acme Ltd.";
    config.identity.supportEmail = "help@acme.example";
    config.runtime.ports = {
      landing: 4000,
      web: 4001,
      admin: 4002,
      storybook: 4003,
      "landing-static": 4004,
    };
    config.runtime.authCookiePrefix = "acme_cloud-2";
    config.brand.tokenOverrides = { "--primary": "oklch(0.55 0.2 260)" };
    config.brand.email.lang = "pt-BR";
    config.brand.icons.svg = "apps/web/branding/icon.svg";
    config.features.waitlist = false;

    const valid = validateAppConfig(config);
    expect(valid.identity.productName).toBe("Acme Cloud");
    expect(localOrigin(valid, "admin")).toBe("http://localhost:4002");
    expect(valid.runtime.authCookiePrefix).toBe("acme_cloud-2");
    expect(valid.features.waitlist).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(() => validateAppConfig(null)).toThrow(AppConfigError);
    expect(() => validateAppConfig([])).toThrow("app.config.ts must export an object");
  });

  it("names every invalid setting in one error", () => {
    const config = draft();
    config.identity.productName = "";
    config.runtime.ports.web = 80;
    config.features.environmentBanner = "yes" as unknown as boolean;

    const issues = issuesOf(config);
    expect(issues).toHaveLength(3);
    expect(issues.join("\n")).toContain("identity.productName");
    expect(issues.join("\n")).toContain("runtime.ports.web");
    expect(issues.join("\n")).toContain("features.environmentBanner");
    expect(() => validateAppConfig(config)).toThrow(/Invalid app\.config\.ts:\n {2}- /);
  });

  it("accepts a locale subset and rejects empty, duplicate or en-less lists", () => {
    const config = draft();
    config.i18n.locales = ["en", "de"];
    expect(validateAppConfig(config).i18n.locales).toEqual(["en", "de"]);

    config.i18n.locales = [];
    expect(issuesOf(config).join("\n")).toContain("i18n.locales: must be a non-empty array");
    config.i18n.locales = ["en", "de", "de", "Not a tag"];
    expect(issuesOf(config)).toEqual([
      'i18n.locales[2]: "de" is listed twice',
      'i18n.locales[3]: must be a language tag such as en or pt-BR (got "Not a tag")',
    ]);
    config.i18n.locales = ["de"];
    expect(issuesOf(config)).toEqual(['i18n.locales: must include "en", the fallback locale']);
  });

  it("rejects unknown settings, which are usually typos", () => {
    const config = draft();
    (config.identity as Record<string, unknown>).prodcutName = "Typo";
    (config.runtime.ports as Record<string, number>).worker = 4999;
    expect(issuesOf(config)).toEqual([
      "identity.prodcutName: unknown setting",
      "runtime.ports.worker: unknown setting",
    ]);
  });

  it("rejects duplicate ports", () => {
    const config = draft();
    config.runtime.ports.admin = config.runtime.ports.web;
    expect(issuesOf(config)).toEqual([
      `runtime.ports.admin: port ${config.runtime.ports.web} is already used by runtime.ports.web`,
    ]);
  });

  it("rejects ports that are not unprivileged integers", () => {
    for (const port of [0, 1023, 65536, 3001.5, "3001", Number.NaN]) {
      const config = draft();
      (config.runtime.ports as Record<string, unknown>).web = port;
      expect(issuesOf(config)).toHaveLength(1);
    }
  });

  it("rejects cookie prefixes that would make cookie names ambiguous", () => {
    for (const prefix of ["", "my.app", "__Secure-app", "_app", "my app", "app;x", "-app"]) {
      const config = draft();
      config.runtime.authCookiePrefix = prefix;
      expect(issuesOf(config).length).toBeGreaterThan(0);
    }
  });

  it("rejects display text that would need escaping", () => {
    for (const name of ["<b>Acme</b>", "Acme {x}", 'Say "hi"', " Acme", "Acme\n"]) {
      const config = draft();
      config.identity.productName = name;
      expect(issuesOf(config).length).toBeGreaterThan(0);
    }
  });

  it("rejects malformed emails, colours and language tags", () => {
    const config = draft();
    config.identity.supportEmail = "support";
    config.brand.email.palette.accent = "red";
    config.brand.email.lang = "English";
    expect(issuesOf(config)).toHaveLength(3);
  });

  it("rejects icon paths that leave the repository or have the wrong type", () => {
    for (const path of ["/etc/icon.svg", "../icon.svg", "assets/../../icon.svg", "icon.png"]) {
      const config = draft();
      config.brand.icons.svg = path;
      expect(issuesOf(config)).toHaveLength(1);
    }
  });

  it("rejects token overrides that are not custom properties or could break out of CSS", () => {
    const config = draft();
    config.brand.tokenOverrides = {
      color: "red",
      "--primary": "red;} body{display:none",
      "--accent": "</style><script>",
    };
    expect(issuesOf(config)).toHaveLength(3);
  });
});

describe("tokenOverrideCss", () => {
  it("is empty without overrides", () => {
    const config = validateAppConfig({ ...draft(), brand: { ...draft().brand, tokenOverrides: {} } });
    expect(tokenOverrideCss(config)).toBe("");
  });

  it("sets each override on :root", () => {
    const config = draft();
    config.brand.tokenOverrides = { "--primary": "#123456", "--radius": "0.25rem" };
    expect(tokenOverrideCss(validateAppConfig(config))).toBe(
      ":root{--primary:#123456;--radius:0.25rem}",
    );
  });
});
