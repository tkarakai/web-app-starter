// Server-only entry point for @repo/design-system.
//
// Kept out of the main barrel so that reading configuration from process.env
// stays a server concern — a client component importing `@repo/design-system`
// should never pull it in.
//
// Import as: `import { readPublicConfigFromEnv } from "@repo/design-system/server";`
export { readPublicConfigFromEnv } from "./components/config/public-config-server";
