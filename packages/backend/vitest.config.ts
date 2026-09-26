import { localAppOrigin } from "@repo/app-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["convex/**/*.test.ts"],
    // Local origins, as dev-start.sh sets them on a local backend (app.config.ts ports).
    env: {
      SITE_URL: localAppOrigin("web"),
      ADMIN_SITE_URL: localAppOrigin("admin"),
      LANDING_URL: localAppOrigin("landing"),
    },
    server: {
      deps: {
        inline: [/convex-test/],
      },
    },
  },
});
