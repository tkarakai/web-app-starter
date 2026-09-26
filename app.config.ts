/**
 * App configuration: the values an app built on the starter is expected to change.
 *
 * This file is app-owned. Starter code reads these values and never repeats
 * them as literals, so renaming the product, moving a port or changing the
 * auth cookie prefix is an edit here and nowhere else.
 *
 * - Validated when loaded (`packages/app-config/src/schema.ts`): an invalid
 *   value stops dev, build and tests with a message naming the setting.
 * - Everything here is public: it is checked in and bundled into client code.
 *   Per-deployment values (deployed URLs, Convex URLs) and secrets stay
 *   environment variables; see AGENTS.md "Environment Variables".
 * - Consumers: import `appConfig` from `@repo/app-config` in TypeScript; shell
 *   scripts and CI use `scripts/app-config.ts` (see docs/claude/development.md).
 */
import type { AppConfig } from "./packages/app-config/src/schema.ts";

const productName = "Web App Starter";
const supportEmail = "support@example.com";

const appConfig = {
  identity: {
    productName,
    legalEntity: productName,
    supportEmail,
  },

  runtime: {
    // Local development and CI ports. Deployed apps ignore them.
    ports: {
      landing: 3000,
      web: 3001,
      admin: 3002,
      storybook: 3003,
      "landing-static": 3004,
    },
    // Better Auth's own default. Change it when another Better Auth app shares
    // the host (e.g. localhost). Changing it signs every existing user out.
    authCookiePrefix: "better-auth",
  },

  brand: {
    icons: {
      svg: "packages/design-system/assets/icon.svg",
      ico: "packages/design-system/assets/favicon.ico",
      appleTouchIcon: "packages/design-system/assets/apple-touch-icon.png",
    },
    // CSS custom properties from packages/design-system/tokens/, e.g.
    // { "--primary": "oklch(0.55 0.2 260)" }.
    tokenOverrides: {},
    email: {
      lang: "en",
      palette: {
        background: "#f4f4f5",
        surface: "#ffffff",
        heading: "#18181b",
        text: "#3f3f46",
        mutedText: "#71717a",
        subtleText: "#a1a1aa",
        border: "#e4e4e7",
        accent: "#18181b",
        accentGradientEnd: "#3f3f46",
        accentText: "#ffffff",
      },
      footerText: `Sent by ${productName}. Questions? Write to ${supportEmail}.`,
    },
  },

  // Optional platform features. Switching one off hides it; its code stays.
  features: {
    waitlist: true,
    invitations: true,
    announcements: true,
    environmentBanner: true,
  },
} satisfies AppConfig;

export default appConfig;
