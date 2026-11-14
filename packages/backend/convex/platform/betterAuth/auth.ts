// This file is used ONLY by the Better Auth CLI for schema generation.
// It mirrors the plugin configuration from @convex-dev/better-auth's
// built-in auth-options.ts (for schema compatibility) plus our custom
// plugins. Do NOT import this file at runtime.
// Better Auth 1.7 removed the oidcProvider plugin (adapter 0.13 dropped it too);
// its oauth* tables stay in schema.ts so an upgrade never drops existing tables.
import { convexAdapter } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth/minimal";
import {
  admin,
  anonymous,
  bearer,
  emailOTP,
  genericOAuth,
  jwt,
  magicLink,
  oneTap,
  oneTimeToken,
  organization,
  phoneNumber,
  twoFactor,
  username,
} from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sessionFields, userFields } from "../sessionFields";

export const auth = betterAuth({
  database: convexAdapter({} as never, {} as never),
  rateLimit: {
    storage: "database",
  },
  emailAndPassword: {
    enabled: true,
  },
  session: { additionalFields: sessionFields },
  user: { additionalFields: userFields },
  plugins: [
    // Plugins from @convex-dev/better-auth built-in config (for schema compat)
    twoFactor(),
    anonymous(),
    username(),
    phoneNumber(),
    magicLink({ sendMagicLink: async () => {} }),
    emailOTP({ sendVerificationOTP: async () => {} }),
    passkey(),
    genericOAuth({
      config: [{ clientId: "", clientSecret: "", providerId: "" }],
    }),
    oneTap(),
    bearer(),
    oneTimeToken(),
    jwt(),
    convex({
      authConfig: { providers: [{ applicationID: "convex", domain: "" }] },
    }),
    // Our custom plugins
    admin(),
    organization(),
  ],
} as BetterAuthOptions);
