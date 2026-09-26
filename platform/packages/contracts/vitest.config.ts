import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // next-intl imports "next/server" without an extension, which Node's ESM loader rejects.
    server: { deps: { inline: ["next-intl"] } },
  },
});
