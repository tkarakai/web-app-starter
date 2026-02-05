import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/convex": resolve(__dirname, "./convex"),
    },
  },
  // Use worktree-specific cache directory for isolation
  cacheDir: resolve(__dirname, "node_modules/.vite"),
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Only include .test.tsx files - .test.ts files use bun:test and run with Bun
    // Convex tests should be run with `npx convex-test` (has import.meta.glob support)
    include: ["tests/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "convex/**/*.test.ts"],
    // Worktree isolation settings
    pool: "forks", // Use forks instead of threads for better isolation
    poolOptions: {
      forks: {
        isolate: true, // Isolate each test file
      },
    },
    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}", "convex/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
        "**/node_modules/**",
        "**/_generated/**",
        "**/types/**",
      ],
      thresholds: {
        // Minimum coverage thresholds - enforced in CI
        // These are starting points; increase as coverage improves
        lines: 2,
        branches: 40,
        functions: 40,
        statements: 2,
        // Fail build if thresholds not met
        autoUpdate: false,
      },
    },
  },
});
