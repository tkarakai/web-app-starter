#!/usr/bin/env node
/**
 * Check the message files: platform and app, as they are merged at load.
 *
 *   ./platform/tooling/node-ts.sh platform/tooling/check-i18n.ts [ROOT]    (bun run check:i18n)
 *
 * Fails (exit 1) and names each problem when:
 *   - a platform locale file (platform/packages/i18n/messages/<locale>.json) lacks a key the
 *     English one has, or has one it doesn't;
 *   - a locale in app.config.ts `i18n.locales` has no app file (packages/messages/<locale>.json),
 *     or the app file's keys differ from the app's English file;
 *   - an app namespace has the same name as a platform namespace (each namespace has one owner);
 *   - packages/messages/overrides.json overrides a platform string that doesn't exist (a stale
 *     override, usually after an upgrade renamed or removed the key), or overrides a locale the
 *     app doesn't ship.
 *
 * Adding an app string touches only packages/messages/; see the platform-add-strings skill.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { validateAppConfig } from "../packages/app-config/src/schema.ts";
import { leafPaths, namespaceClashes, staleOverrides, type Messages } from "../packages/i18n/src/merge.ts";

export const PLATFORM_DIR = "platform/packages/i18n/messages";
export const APP_DIR = "packages/messages";

function readJson(file: string): Messages {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Messages;
}

/** Keys in `actual` missing from, or extra to, `expected`, as problem lines. */
function keyDifferences(label: string, expected: Messages, actual: Messages): string[] {
  const want = new Set(leafPaths(expected));
  const have = new Set(leafPaths(actual));
  const problems: string[] = [];
  for (const key of want) if (!have.has(key)) problems.push(`${label}: missing ${key}`);
  for (const key of have) if (!want.has(key)) problems.push(`${label}: unexpected ${key} (not in the English file)`);
  return problems;
}

/** Every problem with the message files under `root`, for the given shipped locales. */
export function checkMessages(root: string, appLocales: readonly string[]): string[] {
  const problems: string[] = [];
  const platformDir = path.join(root, PLATFORM_DIR);
  const appDir = path.join(root, APP_DIR);

  const platformEn = readJson(path.join(platformDir, "en.json"));
  const platformLocales = fs.readdirSync(platformDir).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
  for (const locale of platformLocales) {
    if (locale === "en") continue;
    problems.push(...keyDifferences(`${PLATFORM_DIR}/${locale}.json`, platformEn, readJson(path.join(platformDir, `${locale}.json`))));
  }

  const appEnFile = path.join(appDir, "en.json");
  const appEn = fs.existsSync(appEnFile) ? readJson(appEnFile) : {};
  for (const namespace of namespaceClashes(platformEn, appEn)) {
    problems.push(`${APP_DIR}/en.json: namespace "${namespace}" is the platform's; use your own namespace name (or override its strings in overrides.json)`);
  }
  for (const locale of appLocales) {
    if (!platformLocales.includes(locale)) {
      problems.push(`app.config.ts i18n.locales: "${locale}" has no platform messages; supported: ${platformLocales.join(", ")}`);
    }
    if (locale === "en") continue;
    const file = path.join(appDir, `${locale}.json`);
    if (!fs.existsSync(file)) {
      problems.push(`${APP_DIR}/${locale}.json: missing (the locale is in app.config.ts i18n.locales)`);
      continue;
    }
    problems.push(...keyDifferences(`${APP_DIR}/${locale}.json`, appEn, readJson(file)));
  }

  const overridesFile = path.join(appDir, "overrides.json");
  if (fs.existsSync(overridesFile)) {
    const overrides = readJson(overridesFile);
    for (const [locale, tree] of Object.entries(overrides)) {
      const label = `${APP_DIR}/overrides.json`;
      if (!appLocales.includes(locale)) {
        problems.push(`${label}: "${locale}" is not in app.config.ts i18n.locales`);
        continue;
      }
      if (typeof tree !== "object" || !platformLocales.includes(locale)) continue;
      const platform = readJson(path.join(platformDir, `${locale}.json`));
      for (const key of staleOverrides(platform, tree)) {
        problems.push(`${label}: ${locale}.${key} overrides no platform string (renamed or removed?)`);
      }
    }
  }
  return problems;
}

export async function main(argv: readonly string[], out: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Promise<number> {
  const root = path.resolve(argv[0] ?? ".");
  const raw = (await import(pathToFileURL(path.join(root, "app.config.ts")).href) as { default: unknown }).default;
  const config = validateAppConfig(raw);
  const problems = checkMessages(root, config.i18n.locales);
  for (const problem of problems) out(problem);
  out(problems.length === 0 ? "Message files are consistent." : `check-i18n: ${problems.length} problem(s)`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
