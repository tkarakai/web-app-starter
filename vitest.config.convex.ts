import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/convex": resolve(__dirname, "./convex"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["convex/**/*.test.ts"],
    server: {
      deps: {
        inline: [/convex-test/],
      },
    },
  },
});
