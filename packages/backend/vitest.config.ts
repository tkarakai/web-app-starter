import { localAppOrigin } from "@web-app-starter/app-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Bound concurrent Convex/Auth fixtures to avoid starving five-second tests.
    maxWorkers: 2,
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
