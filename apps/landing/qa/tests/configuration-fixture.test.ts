import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import appConfig from "../../../../app.config.ts";
import { validateAppConfig } from "../../../../platform/packages/app-config/src/schema.ts";
import { adopt } from "../../../../platform/tooling/adopt.ts";
import { copyConfigurationFixture, englishLandingConfig } from "../helpers/configuration-fixture.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8" }).trim();
}

function release(root: string): string {
  git(root, "init", "--quiet");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "Fixture release");
  return git(root, "rev-parse", "HEAD");
}

for (const downstream of [false, true]) {
  test(`fresh landing fixture adopts from ${downstream ? "adopted downstream" : "product"} source`, () => {
    const temporary = mkdtempSync(path.join(repository, ".landing-fixture-tests-"));
    try {
      const source = path.join(temporary, "source");
      const destination = path.join(temporary, "destination");
      mkdirSync(source);
      mkdirSync(destination);
      for (const file of ["app.config.ts", "renovate.json", "package.json", "tsconfig.json", "eslint.config.mjs", "platform/VERSION",
        "packages/backend/convex/schema.ts", "packages/backend/convex/http.ts", "packages/backend/convex/convex.config.ts"]) {
        mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
        cpSync(path.join(repository, file), path.join(source, file));
      }
      cpSync(path.join(repository, "platform/templates"), path.join(source, "platform/templates"), { recursive: true });
      const commit = release(source);
      const options = { name: "Landing Acceptance", repo: "fixture/landing", install: false, build: false, upstream: false, updates: "deferred" as const };
      const services = { release: () => ({ commit, version: readFileSync(path.join(source, "platform/VERSION"), "utf8").trim() }), command: () => "" };
      if (downstream) {
        assert.equal(adopt(source, { ...options, repo: "fixture/downstream" }, () => {}, services), 0);
      }
      const previousRecord = downstream ? readFileSync(path.join(source, ".github/update-delivery.json"), "utf8") : undefined;
      copyConfigurationFixture(source, destination);
      assert.equal(existsSync(path.join(destination, ".platform-base.json")), false);
      assert.equal(existsSync(path.join(destination, ".github/update-delivery.json")), false);
      const freshCommit = release(destination);
      assert.equal(adopt(destination, options, () => {}, { ...services, release: () => ({ ...services.release(), commit: freshCommit }) }), 0);
      assert.equal(JSON.parse(readFileSync(path.join(destination, ".platform-base.json"), "utf8")).commit, freshCommit);
      assert.equal(JSON.parse(readFileSync(path.join(destination, ".github/update-delivery.json"), "utf8")).repository, "fixture/landing");
      if (downstream) assert.equal(readFileSync(path.join(source, ".github/update-delivery.json"), "utf8"), previousRecord);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}

for (const defaultLocale of [undefined, "hu"]) {
  test(`English fixture loads all feature combinations with source default ${defaultLocale ?? "implicit"}`, async () => {
    const temporary = mkdtempSync(path.join(repository, ".landing-fixture-tests-"));
    try {
      const source = validateAppConfig({ ...appConfig, i18n: { locales: ["en", "hu"], ...(defaultLocale ? { defaultLocale } : {}) } });
      for (const waitlist of [false, true]) {
        for (const announcements of [false, true]) {
          const file = path.join(temporary, `config-${waitlist}-${announcements}.ts`);
          writeFileSync(file, `export default ${JSON.stringify(englishLandingConfig(source, waitlist, announcements))};\n`);
          const actual = validateAppConfig((await import(pathToFileURL(file).href)).default);
          assert.deepEqual(actual.i18n, { locales: ["en"], defaultLocale: "en" });
          assert.deepEqual(actual.features, { ...source.features, waitlist, announcements });
          assert.deepEqual(actual.identity, source.identity);
        }
      }
      assert.deepEqual(source.i18n.locales, ["en", "hu"]);
      assert.equal(source.i18n.defaultLocale, defaultLocale ?? "en");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}
