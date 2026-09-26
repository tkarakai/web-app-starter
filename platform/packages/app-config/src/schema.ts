/**
 * Shape, validation and derived values for the root `app.config.ts`.
 *
 * This file is platform code; `app.config.ts` is the app-owned seam that holds
 * the values. It has no imports on purpose: the dev-script reader
 * (`platform/tooling/app-config.ts`) loads it with Node's type stripping, which only
 * resolves explicit `.ts` paths, while Next.js, Convex and Playwright load it
 * through their bundlers. A file with no imports works in all of them.
 *
 * Only app-owned identity and defaults belong in the config. Per-deployment
 * values (deployed URLs, Convex URLs) and secrets stay environment variables:
 * everything here is bundled into client code and checked into git.
 */

/**
 * The starter's apps, keyed by their directory name. `apps/demo` is not one of
 * them: it stands in for a separate business app in the starter-upgrade tests,
 * is copied out of the repository to run, and owns its own settings.
 */
export const APP_IDS = ["landing", "web", "admin", "storybook", "landing-static"] as const;
export type AppId = (typeof APP_IDS)[number];

/**
 * Where each app lives, relative to the repository root. Reference apps are in
 * `apps/` (app zone); the admin dashboard and the component showcase are
 * platform apps in `platform/apps/`. Scripts and CI read this through
 * `platform/tooling/app-config.ts dir <app>` instead of assuming `apps/<app>`.
 */
export const APP_DIRS: Readonly<Record<AppId, string>> = {
  landing: "apps/landing",
  web: "apps/web",
  admin: "platform/apps/admin",
  storybook: "platform/apps/storybook",
  "landing-static": "apps/landing-static",
};

/** Colours used by the transactional email templates (`#rgb` or `#rrggbb`). */
export type EmailPalette = {
  /** Page background around the card, and behind one-time codes. */
  background: string;
  /** The card itself. */
  surface: string;
  /** Headings, and the code in one-time-code emails. */
  heading: string;
  /** Body text. */
  text: string;
  /** Secondary text such as expiry notes. */
  mutedText: string;
  /** Fallback-link and footer text. */
  subtleText: string;
  /** Divider lines. */
  border: string;
  /** Call-to-action button and header accent. */
  accent: string;
  /** Second stop of the header accent gradient. */
  accentGradientEnd: string;
  /** Text on the call-to-action button. */
  accentText: string;
};

export type FeatureSwitches = {
  waitlist: boolean;
  invitations: boolean;
  announcements: boolean;
  environmentBanner: boolean;
};

export type AppConfig = {
  identity: {
    /** Product name shown in page titles, headers, emails and authenticator apps. */
    productName: string;
    /** Legal entity shown in copyright notices. */
    legalEntity: string;
    /** Address users can write to; shown in email footers. */
    supportEmail: string;
  };
  runtime: {
    /** Local development and CI port for each app. Deployed apps ignore these. */
    ports: Record<AppId, number>;
    /**
     * Better Auth cookie prefix. Cookies are named `<prefix>.session_token`
     * (and `__Secure-<prefix>.session_token` over HTTPS). Two apps sharing a
     * host, such as localhost during development, need different prefixes or
     * they sign each other out. Changing it signs every existing user out.
     */
    authCookiePrefix: string;
  };
  brand: {
    /** Icon sources, relative to the repository root; copied into each app's `public/`. */
    icons: {
      svg: string;
      ico: string;
      appleTouchIcon: string;
    };
    /**
     * Design-token overrides: CSS custom properties from
     * `platform/packages/design-system/tokens/`, set on `:root` in every app, e.g.
     * `{ "--primary": "oklch(0.55 0.2 260)" }`. Empty keeps the design system's values.
     */
    tokenOverrides: Record<string, string>;
    email: {
      /** `lang` attribute of the email templates: the language their copy is written in. */
      lang: string;
      palette: EmailPalette;
      /** Line under every email, e.g. a postal address or why the reader got the email. */
      footerText: string;
    };
  };
  /**
   * Optional platform features. A feature switched off keeps its code (so it
   * keeps receiving starter fixes) but is hidden from the product.
   */
  features: FeatureSwitches;
};

/** Thrown when `app.config.ts` holds an invalid value. Lists every problem at once. */
export class AppConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid app.config.ts:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "AppConfigError";
    this.issues = issues;
  }
}

type Issues = string[];
type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return String(value);
}

function objectAt(parent: Obj, key: string, path: string, issues: Issues): Obj {
  const value = parent[key];
  if (isObject(value)) return value;
  issues.push(`${path}: must be an object (got ${show(value)})`);
  return {};
}

function rejectUnknownKeys(value: Obj, allowed: readonly string[], path: string, issues: Issues): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${path}.${key}: unknown setting`);
  }
}

// Printable text only: values end up in HTML, email headers and shell scripts,
// where control characters are never intended.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

type TextRule = { max: number; pattern: RegExp; hint: string };

function text(parent: Obj, key: string, path: string, issues: Issues, rule: TextRule): string {
  const value = parent[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path}: must be a non-empty string (got ${show(value)})`);
    return "";
  }
  if (value !== value.trim()) issues.push(`${path}: must not start or end with whitespace`);
  if (value.length > rule.max) issues.push(`${path}: must be at most ${rule.max} characters`);
  if (CONTROL_CHARACTERS.test(value)) issues.push(`${path}: must not contain control characters`);
  else if (!rule.pattern.test(value)) issues.push(`${path}: ${rule.hint} (got ${show(value)})`);
  return value;
}

function bool(parent: Obj, key: string, path: string, issues: Issues): boolean {
  const value = parent[key];
  if (typeof value === "boolean") return value;
  issues.push(`${path}: must be true or false (got ${show(value)})`);
  return false;
}

// Display text lands in HTML, email templates and page titles. Characters that
// need escaping there, or that ICU message syntax treats specially, are refused
// rather than escaped in every consumer.
const DISPLAY_TEXT: TextRule = {
  max: 120,
  pattern: /^[^{}<>"`\\]+$/,
  hint: 'must not contain { } < > " ` or \\',
};
const EMAIL_ADDRESS: TextRule = {
  max: 254,
  pattern: /^[^\s@<>"]+@[^\s@<>".]+(?:\.[^\s@<>".]+)+$/,
  hint: "must be an email address",
};
// Better Auth builds `<prefix>.<name>` and `__Secure-<prefix>.<name>`; a dot or
// a leading `__` would make the names ambiguous.
const COOKIE_PREFIX: TextRule = {
  max: 64,
  pattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
  hint: "must start with a letter or digit and contain only letters, digits, - and _",
};
const HEX_COLOUR: TextRule = {
  max: 7,
  pattern: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
  hint: "must be a hex colour such as #18181b",
};
const LANGUAGE_TAG: TextRule = {
  max: 35,
  pattern: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
  hint: "must be a language tag such as en or pt-BR",
};
// A token value is written into a <style> block: nothing that could end the
// declaration, the rule or the element.
const CSS_VALUE: TextRule = {
  max: 200,
  pattern: /^[^;{}<>\\]+$/,
  hint: "must not contain ; { } < > or \\",
};
const CSS_CUSTOM_PROPERTY = /^--[a-z0-9-]+$/;

/** A repository-relative path with the given extension: no leading "/", no ".." segment. */
function relativePath(extension: string): TextRule {
  return {
    max: 200,
    pattern: new RegExp(`^(?!/)(?!(?:.*/)?\\.\\.(?:/|$))[A-Za-z0-9._/-]+\\.${extension}$`),
    hint: `must be a path relative to the repository root, without "..", ending in .${extension}`,
  };
}

const PALETTE_KEYS = [
  "background",
  "surface",
  "heading",
  "text",
  "mutedText",
  "subtleText",
  "border",
  "accent",
  "accentGradientEnd",
  "accentText",
] as const satisfies readonly (keyof EmailPalette)[];

const FEATURE_KEYS = [
  "waitlist",
  "invitations",
  "announcements",
  "environmentBanner",
] as const satisfies readonly (keyof FeatureSwitches)[];

function validatePorts(runtime: Obj, issues: Issues): Record<AppId, number> {
  const raw = objectAt(runtime, "ports", "runtime.ports", issues);
  rejectUnknownKeys(raw, APP_IDS, "runtime.ports", issues);
  const ports = {} as Record<AppId, number>;
  const seen = new Map<number, AppId>();
  for (const app of APP_IDS) {
    const value = raw[app];
    const path = `runtime.ports.${app}`;
    ports[app] = 0;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535) {
      issues.push(`${path}: must be an integer from 1024 to 65535 (got ${show(value)})`);
      continue;
    }
    const clash = seen.get(value);
    if (clash) issues.push(`${path}: port ${value} is already used by runtime.ports.${clash}`);
    seen.set(value, app);
    ports[app] = value;
  }
  return ports;
}

function validateTokenOverrides(brand: Obj, issues: Issues): Record<string, string> {
  const raw = objectAt(brand, "tokenOverrides", "brand.tokenOverrides", issues);
  const tokens: Record<string, string> = {};
  for (const name of Object.keys(raw)) {
    const path = `brand.tokenOverrides[${JSON.stringify(name)}]`;
    if (!CSS_CUSTOM_PROPERTY.test(name)) {
      issues.push(`${path}: the name must be a CSS custom property such as "--primary"`);
      continue;
    }
    tokens[name] = text(raw, name, path, issues, CSS_VALUE);
  }
  return tokens;
}

function validateEmail(brand: Obj, issues: Issues): AppConfig["brand"]["email"] {
  const email = objectAt(brand, "email", "brand.email", issues);
  rejectUnknownKeys(email, ["lang", "palette", "footerText"], "brand.email", issues);
  const rawPalette = objectAt(email, "palette", "brand.email.palette", issues);
  rejectUnknownKeys(rawPalette, PALETTE_KEYS, "brand.email.palette", issues);
  const palette = {} as EmailPalette;
  for (const key of PALETTE_KEYS) {
    palette[key] = text(rawPalette, key, `brand.email.palette.${key}`, issues, HEX_COLOUR);
  }
  return {
    lang: text(email, "lang", "brand.email.lang", issues, LANGUAGE_TAG),
    palette,
    footerText: text(email, "footerText", "brand.email.footerText", issues, {
      ...DISPLAY_TEXT,
      max: 300,
    }),
  };
}

/**
 * Check a raw config and return it typed. Throws an {@link AppConfigError}
 * listing every invalid or unknown value, so one run shows all mistakes.
 */
export function validateAppConfig(input: unknown): AppConfig {
  const issues: Issues = [];
  if (!isObject(input)) issues.push("app.config.ts must export an object");
  const root = isObject(input) ? input : {};
  rejectUnknownKeys(root, ["identity", "runtime", "brand", "features"], "config", issues);

  const identity = objectAt(root, "identity", "identity", issues);
  rejectUnknownKeys(identity, ["productName", "legalEntity", "supportEmail"], "identity", issues);
  const runtime = objectAt(root, "runtime", "runtime", issues);
  rejectUnknownKeys(runtime, ["ports", "authCookiePrefix"], "runtime", issues);
  const brand = objectAt(root, "brand", "brand", issues);
  rejectUnknownKeys(brand, ["icons", "tokenOverrides", "email"], "brand", issues);
  const icons = objectAt(brand, "icons", "brand.icons", issues);
  rejectUnknownKeys(icons, ["svg", "ico", "appleTouchIcon"], "brand.icons", issues);
  const features = objectAt(root, "features", "features", issues);
  rejectUnknownKeys(features, FEATURE_KEYS, "features", issues);

  const config: AppConfig = {
    identity: {
      productName: text(identity, "productName", "identity.productName", issues, {
        ...DISPLAY_TEXT,
        max: 60,
      }),
      legalEntity: text(identity, "legalEntity", "identity.legalEntity", issues, DISPLAY_TEXT),
      supportEmail: text(identity, "supportEmail", "identity.supportEmail", issues, EMAIL_ADDRESS),
    },
    runtime: {
      ports: validatePorts(runtime, issues),
      authCookiePrefix: text(
        runtime,
        "authCookiePrefix",
        "runtime.authCookiePrefix",
        issues,
        COOKIE_PREFIX,
      ),
    },
    brand: {
      icons: {
        svg: text(icons, "svg", "brand.icons.svg", issues, relativePath("svg")),
        ico: text(icons, "ico", "brand.icons.ico", issues, relativePath("ico")),
        appleTouchIcon: text(
          icons,
          "appleTouchIcon",
          "brand.icons.appleTouchIcon",
          issues,
          relativePath("png"),
        ),
      },
      tokenOverrides: validateTokenOverrides(brand, issues),
      email: validateEmail(brand, issues),
    },
    features: {
      waitlist: bool(features, "waitlist", "features.waitlist", issues),
      invitations: bool(features, "invitations", "features.invitations", issues),
      announcements: bool(features, "announcements", "features.announcements", issues),
      environmentBanner: bool(features, "environmentBanner", "features.environmentBanner", issues),
    },
  };

  if (issues.length > 0) throw new AppConfigError(issues);
  return config;
}

/** The URL an app is served on in local development and CI. */
export function localOrigin(config: AppConfig, app: AppId): string {
  return `http://localhost:${config.runtime.ports[app]}`;
}

/** The `:root{...}` rule for the configured design-token overrides, or "" when there are none. */
export function tokenOverrideCss(config: AppConfig): string {
  const declarations = Object.entries(config.brand.tokenOverrides).map(
    ([name, value]) => `${name}:${value}`,
  );
  return declarations.length === 0 ? "" : `:root{${declarations.join(";")}}`;
}
