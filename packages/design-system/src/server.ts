// Server-only entry point for @repo/design-system.
//
// These helpers import `next/headers`, which cannot be bundled for the browser.
// Keeping them out of the main barrel means a client component importing
// `@repo/design-system` does not drag server-only modules into its bundle.
//
// Import as: `import { readPublicConfigFromEnv } from "@repo/design-system/server";`
export {
  readPublicConfigFromEnv,
  getRequestOrigin,
} from "./components/config/public-config-server";
