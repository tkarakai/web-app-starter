/**
 * Exercise the retained landing tests after real adoption, without changing this checkout.
 * Run with node: --components, --e2e, --exports, or --all (the default).
 * Only disposable fixture repositories are committed; no remote commands or installs run.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { adopt } from "../../../../platform/tooling/adopt.ts";
import { validateAppConfig } from "../../../../platform/packages/app-config/src/schema.ts";
import { copyConfigurationFixture, englishLandingConfig } from "./configuration-fixture.ts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const configBefore = readFileSync(path.join(source, "app.config.ts"), "utf8");
const requested = process.argv.slice(2);
const stages = requested.length === 0 || requested.includes("--all")
  ? ["--components", "--e2e", "--exports"] : requested;
assert(stages.every(stage => ["--components", "--e2e", "--exports"].includes(stage)), "Unknown acceptance stage");
mkdirSync(path.join(source, ".lavish"), { recursive: true });
const root = mkdtempSync(path.join(source, ".lavish/landing-configuration-"));
const app = path.join(root, "apps/landing");

function run(command: string, args: string[], cwd = root, env: Record<string, string> = {}): void {
  process.stdout.write(`\n$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

try {
  // Keep workspace symlinks relative so they resolve to the fixture's app configuration.
  // Copy pinned dependencies too: Turbopack requires their real paths inside its root.
  copyConfigurationFixture(source, root);
  if (stages.includes("--e2e") || stages.includes("--exports")) {
    cpSync(path.join(source, "node_modules/.bun"), path.join(root, "node_modules/.bun"), {
      recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    });
  } else symlinkSync(path.join(source, "node_modules/.bun"), path.join(root, "node_modules/.bun"), "dir");
  for (const args of [["init", "--quiet"], ["add", "-A"], ["commit", "--quiet", "-m", "Fixture release"]]) {
    execFileSync("git", ["-c", "user.name=Landing fixture", "-c", "user.email=landing@example.test", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root });
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const lines: string[] = [];
  assert.equal(adopt(root, {
    name: "Landing Acceptance", supportEmail: "help@landing.example.test", repo: "fixture/landing",
    install: false, build: false, upstream: false, updates: "deferred",
  }, line => lines.push(line), {
    release: () => ({ commit, version: readFileSync(path.join(root, "platform/VERSION"), "utf8").trim() }),
    command: () => "",
  }), 0, lines.join("\n"));
  const adopted = validateAppConfig((await import(pathToFileURL(path.join(root, "app.config.ts")).href)).default);
  assert(existsSync(path.join(root, ".platform-base.json")));
  for (const file of ["qa/tests/hero-cta.test.tsx", "qa/e2e/dynamic-features.spec.ts"]) {
    assert.equal(readFileSync(path.join(app, file), "utf8"), readFileSync(path.join(source, "apps/landing", file), "utf8"), `Adoption changed retained ${file}`);
  }
  run("bash", ["platform/tooling/copy-shared-assets.sh"]);

  for (const [waitlist, announcements] of [[true, true], [false, true], [true, false], [false, false]]) {
    process.stdout.write(`\n=== Adopted landing: waitlist=${waitlist}, announcements=${announcements}, locales=en ===\n`);
    const text = `export default ${JSON.stringify(englishLandingConfig(adopted, waitlist, announcements), null, 2)};\n`;
    writeFileSync(path.join(root, "app.config.ts"), text);
    const raw = (await import(`${pathToFileURL(path.join(root, "app.config.ts")).href}?waitlist=${waitlist}&announcements=${announcements}`)).default;
    const config = validateAppConfig(raw);
    assert.equal(config.features.waitlist, waitlist);
    assert.equal(config.features.announcements, announcements);
    assert.deepEqual(config.i18n.locales, ["en"]);
    assert.equal(config.i18n.defaultLocale, "en");
    assert.equal(config.identity.productName, "Landing Acceptance");
    const env = {
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000", NEXT_PUBLIC_WEB_APP_URL: "https://web.example.test",
      NEXT_PUBLIC_CONVEX_SITE_URL: "https://backend.example.test", CI: "true", NEXT_TELEMETRY_DISABLED: "1",
    };
    if (stages.includes("--components")) {
      run("bun", ["run", "test:unit"], app, env);
      // Test discovery itself must follow the adopted configuration, without feature skips.
      const listing = execFileSync("./node_modules/.bin/playwright", ["test", "--list"], { cwd: app, encoding: "utf8", env: { ...process.env, ...env } });
      assert(listing.includes(waitlist ? "inline waitlist submits" : "disabled waitlist stays closed"), listing);
      assert(listing.includes(announcements ? "announcements show details" : "disabled announcements expose no banner"), listing);
    }
    if (stages.includes("--e2e")) {
      rmSync(path.join(app, ".next"), { recursive: true, force: true });
      const port = await availablePort();
      const origin = `http://127.0.0.1:${port}`;
      const playwrightConfig = path.join(app, "configuration.playwright.ts");
      writeFileSync(playwrightConfig, `import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./qa/e2e", testMatch: "dynamic-features.spec.ts", workers: 1, retries: 0, reporter: "list",
  outputDir: "./qa/test-results/configuration", use: { ...devices["Desktop Chrome"], baseURL: ${JSON.stringify(origin)} },
  webServer: { command: "./node_modules/.bin/next dev --turbopack --hostname 127.0.0.1 --port ${port}", url: ${JSON.stringify(origin)}, reuseExistingServer: false, timeout: 180000, stdout: "pipe", stderr: "pipe" },
});\n`);
      run("./node_modules/.bin/playwright", ["test", "--config=configuration.playwright.ts"], app, { ...env, NEXT_PUBLIC_SITE_URL: origin });
    }
    if (stages.includes("--exports")) {
      for (const configured of [false, true]) {
        run("bun", ["run", "build"], app, { ...env, NEXT_PUBLIC_CONVEX_SITE_URL: configured ? env.NEXT_PUBLIC_CONVEX_SITE_URL : "" });
        run("bash", ["platform/tooling/test-landing-export.sh"], root, { ...env, EXPORT_EXPECT_CONFIGURED: String(configured) });
      }
    }
  }
  process.stdout.write("\nPASS: adopted landing configuration matrix; source app.config.ts preserved.\n");
} finally {
  assert.equal(readFileSync(path.join(source, "app.config.ts"), "utf8"), configBefore, "Source app.config.ts changed during acceptance");
  rmSync(root, { recursive: true, force: true });
}
