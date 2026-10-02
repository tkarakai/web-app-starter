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
    config.i18n.defaultLocale = "en";
    expect(validateAppConfig(config).i18n.locales).toEqual(["en", "de"]);

    config.i18n.locales = [];
    expect(issuesOf(config).join("\n")).toContain("i18n.locales: must be a non-empty array");
    config.i18n.locales = ["en", "de", "de", "Not a tag"];
    expect(issuesOf(config)).toEqual([
      'i18n.locales[2]: "de" is listed twice',
      'i18n.locales[3]: must be a language tag such as en or pt-BR (got "Not a tag")',
    ]);
    config.i18n.locales = ["de"];
    expect(issuesOf(config)).toContain('i18n.locales: must include "en", the fallback locale');
  });

  it("defaults omitted locale settings to English without using list order", () => {
    const config = draft();
    delete config.i18n.defaultLocale;
    config.i18n.locales = ["hu", "en"];
    expect(validateAppConfig(config).i18n.defaultLocale).toBe("en");
    config.i18n.defaultLocale = "hu";
    expect(validateAppConfig(config).i18n.defaultLocale).toBe("hu");
    config.i18n.locales.reverse();
    expect(validateAppConfig(config).i18n.defaultLocale).toBe("hu");
  });

  it("rejects malformed and unshipped default locales", () => {
    const config = draft();
    config.i18n.locales = ["hu", "en"];
    for (const locale of ["fr", "", "not a tag", null, 1]) {
      config.i18n.defaultLocale = locale as string;
      expect(issuesOf(config).some((issue) => issue.startsWith("i18n.defaultLocale:"))).toBe(true);
    }
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

  it("accepts token overrides scoped to every app and to single apps", () => {
    const config = draft();
    config.brand.tokenOverrides = { "*": { "--radius": "0.25rem" }, web: { "--primary": "#123456" }, admin: {} };
    expect(issuesOf(config)).toEqual([]);
  });

  it("rejects mixing flat tokens with per-app scopes, naming the stray token", () => {
    const config = draft();
    config.brand.tokenOverrides = { "--radius": "0.25rem", web: { "--primary": "#123456" } };
    expect(issuesOf(config)).toEqual([
      'brand.tokenOverrides["--radius"]: cannot mix tokens with "web"; put it under "*" to apply it to every app, or under an app id (landing, web, admin, storybook, landing-static)',
    ]);
  });

  it("rejects a misspelt app id, a bad token and a non-object scope inside the scoped form", () => {
    const config = draft();
    // Invalid on purpose, so it needs a cast past the config type.
    config.brand.tokenOverrides = {
      web: { primary: "#123456", "--accent": "</style><script>" },
      Admin: { "--primary": "red" },
      "*": "red",
    } as unknown as AppConfig["brand"]["tokenOverrides"];
    expect(issuesOf(config)).toEqual([
      'brand.tokenOverrides["web"]["primary"]: the name must be a CSS custom property such as "--primary"',
      expect.stringContaining('brand.tokenOverrides["web"]["--accent"]'),
      expect.stringContaining('brand.tokenOverrides["Admin"]: cannot mix tokens with "web", "*"'),
      expect.stringContaining('brand.tokenOverrides["*"]: must be an object'),
    ]);
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

  it("applies flat overrides to every app, with or without an app id", () => {
    const config = draft();
    config.brand.tokenOverrides = { "--primary": "#123456" };
    const resolved = validateAppConfig(config);
    expect(tokenOverrideCss(resolved)).toBe(":root{--primary:#123456}");
    for (const app of APP_IDS) expect(tokenOverrideCss(resolved, app)).toBe(":root{--primary:#123456}");
  });

  it("scopes overrides: an app gets \"*\" plus its own tokens, its own winning, and other apps are untouched", () => {
    const config = draft();
    config.brand.tokenOverrides = {
      "*": { "--radius": "0.25rem", "--primary": "#111111" },
      web: { "--primary": "#123456" },
    };
    const resolved = validateAppConfig(config);
    expect(tokenOverrideCss(resolved, "web")).toBe(":root{--radius:0.25rem;--primary:#123456}");
    expect(tokenOverrideCss(resolved, "admin")).toBe(":root{--radius:0.25rem;--primary:#111111}");
    expect(tokenOverrideCss(resolved)).toBe(":root{--radius:0.25rem;--primary:#111111}");
  });

  it("leaves an app unstyled when only other apps are scoped", () => {
    const config = draft();
    config.brand.tokenOverrides = { web: { "--primary": "#123456" }, landing: { "--primary": "#123456" } };
    const resolved = validateAppConfig(config);
    expect(tokenOverrideCss(resolved, "admin")).toBe("");
    expect(tokenOverrideCss(resolved, "storybook")).toBe("");
    expect(tokenOverrideCss(resolved, "landing")).toBe(":root{--primary:#123456}");
  });
});
