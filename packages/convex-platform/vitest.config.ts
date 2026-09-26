import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    env: {
      // Declared component env: under convex-test the generated `env` reads
      // process.env, so tests supply the values the app would pass.
      SITE_URL: "http://localhost:3001",
    },
    server: {
      deps: {
        inline: [/convex-test/],
      },
    },
  },
});
