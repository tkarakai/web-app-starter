import { constants, cpSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../../../../platform/packages/app-config/src/schema.ts";

export function copyConfigurationFixture(source: string, root: string): void {
  const options = {
    recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    filter: (file: string) => {
      const relative = path.relative(source, file);
      return file !== root
        && ![".platform-base.json", path.join(".github", "update-delivery.json")].includes(relative)
        && !relative.split(path.sep).some(part => [".git", ".bun", ".next", ".vite", "out", ".turbo", ".lavish", "test-results", "playwright-report", "coverage"].includes(part))
        && (!path.basename(file).startsWith(".env") || path.basename(file) === ".env.example");
    },
  };
  for (const entry of readdirSync(source)) {
    const file = path.join(source, entry);
    if (options.filter(file)) cpSync(file, path.join(root, entry), options);
  }
}

export function englishLandingConfig(config: AppConfig, waitlist: boolean, announcements: boolean): AppConfig {
  return {
    ...config,
    features: { ...config.features, waitlist, announcements },
    i18n: { locales: ["en"], defaultLocale: "en" },
  };
}
