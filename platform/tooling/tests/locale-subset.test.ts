// An app may ship any subset of the platform's locales that includes "en" (app.config.ts
// i18n.locales), and profile mutations refuse an unshipped locale. Platform backend tests
// therefore never pass a literal non-English locale to them; they derive one from appConfig.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PLATFORM_BACKEND = path.join(REPO, "packages/backend/convex/platform");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(file);
    return /\.test\.ts$/.test(entry.name) ? [file] : [];
  });
}

test("platform backend tests set only locales every app ships", () => {
  const literal = /api\.platform\.userProfiles\.\w+,\s*\{[^}]*\blocale:\s*"(?!en")[^"]*"/;
  const offenders = testFiles(PLATFORM_BACKEND)
    .filter((file) => literal.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(REPO, file));
  assert.deepEqual(offenders, []);
});
