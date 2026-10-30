import { spawn } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appConfig, type AppConfig, validateAppConfig } from "@web-app-starter/app-config";

export interface WebConfigurationVariant {
  i18n: AppConfig["i18n"];
  waitlist: boolean;
}

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rootConfigUrl = new URL("../../../../../app.config.ts", import.meta.url).href;

/** Run retained tests in fresh processes without editing app.config.ts or leaking mocks. */
export async function runConfiguredWeb(variant: WebConfigurationVariant, suite: "middleware" | "onboarding" | "discovery" | "translations") {
  const directory = await mkdtemp(join(tmpdir(), "web-configuration-"));
  try {
    const config = validateAppConfig({
      ...appConfig,
      i18n: variant.i18n,
      features: { ...appConfig.features, waitlist: variant.waitlist },
    });
    const fixture = join(directory, "app.config.ts");
    const loader = join(directory, "config-loader.mjs");
    await writeFile(fixture, `export default ${JSON.stringify(config)};\n`);
    // Playwright uses Node for discovery. Redirect only the app-owned config import;
    // the retained spec, real fixture registrations, and locale consumers stay intact.
    await writeFile(loader, `
      import { registerHooks } from "node:module";
      registerHooks({ resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        return resolved.url === ${JSON.stringify(rootConfigUrl)}
          ? { ...resolved, url: ${JSON.stringify(pathToFileURL(fixture).href)} }
          : resolved;
      } });
    `);
    await writeFile(join(directory, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    const bunSuite = suite === "middleware" || suite === "onboarding";
    const command = bunSuite
      ? ["bun", "run", "test", suite === "middleware"
        ? join(webRoot, "qa/tests/middleware-auth-routes.test.ts")
        : join(webRoot, "../../platform/packages/auth-ui/qa/tests/onboarding.test.ts"),
      "--preload", join(webRoot, "qa/tests/helpers/web-config.preload.ts")]
      : ["node", join(webRoot, "node_modules/@playwright/test/cli.js"), "test",
        suite === "discovery" ? "qa/e2e/waitlist-signup.spec.ts" : "qa/e2e/waitlist-configuration.spec.ts",
        "--reporter=json", ...(suite === "discovery" ? ["--list"] : ["--workers=1", "--retries=0", `--output=${join(directory, "results")}`])];
    const child = spawn(command, {
      cwd: bunSuite ? directory : webRoot,
      env: {
        ...process.env,
        WEB_QA_CONFIG_VARIANT: JSON.stringify(variant),
        // Workers inherit the resolver so runtime checks use the same variant.
        ...(bunSuite ? {} : {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${JSON.stringify(loader)}`,
          // These checks do not request page/backend fixtures or an app server.
          E2E_BASE_URL: "http://127.0.0.1:1",
        }),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
