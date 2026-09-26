/**
 * Read `app.config.ts` from shell scripts and CI, which cannot import TypeScript.
 *
 *   ./scripts/node-ts.sh scripts/app-config.ts port web          # 3001
 *   ./scripts/node-ts.sh scripts/app-config.ts origin admin      # http://localhost:3002
 *   ./scripts/node-ts.sh scripts/app-config.ts get identity.productName
 *   eval "$(./scripts/node-ts.sh scripts/app-config.ts shell)"   # APP_CONFIG_* variables
 *   ./scripts/node-ts.sh scripts/app-config.ts github-env >> "$GITHUB_ENV"
 *
 * The config is validated first, so an invalid value fails the calling script
 * with the list of problems instead of starting anything on a wrong port.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import rawAppConfig from "../app.config.ts";
import {
  APP_IDS,
  AppConfigError,
  localOrigin,
  validateAppConfig,
  type AppConfig,
  type AppId,
} from "../packages/app-config/src/schema.ts";

/** `landing-static` → `LANDING_STATIC`. */
function envSuffix(app: AppId): string {
  return app.toUpperCase().replace(/-/g, "_");
}

/** The values shell scripts and workflows need, as `APP_CONFIG_*` variables. */
export function configVariables(config: AppConfig): Record<string, string> {
  const variables: Record<string, string> = {
    APP_CONFIG_PRODUCT_NAME: config.identity.productName,
    APP_CONFIG_AUTH_COOKIE_PREFIX: config.runtime.authCookiePrefix,
    APP_CONFIG_ICON_SVG: config.brand.icons.svg,
    APP_CONFIG_ICON_ICO: config.brand.icons.ico,
    APP_CONFIG_ICON_APPLE_TOUCH: config.brand.icons.appleTouchIcon,
  };
  for (const app of APP_IDS) {
    variables[`APP_CONFIG_PORT_${envSuffix(app)}`] = String(config.runtime.ports[app]);
    variables[`APP_CONFIG_ORIGIN_${envSuffix(app)}`] = localOrigin(config, app);
  }
  return variables;
}

/** Quote a value for `eval` in bash: single quotes, with embedded ones closed and reopened. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function lookup(config: AppConfig, dotted: string): unknown {
  let value: unknown = config;
  for (const key of dotted.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function appArgument(value: string | undefined): AppId {
  if (value && (APP_IDS as readonly string[]).includes(value)) return value as AppId;
  throw new UsageError(`expected an app name: ${APP_IDS.join(", ")} (got ${value ?? "nothing"})`);
}

class UsageError extends Error {}

const USAGE = `Usage: app-config.ts <command>
  port <app>          local port of an app
  origin <app>        http://localhost:<port> of an app
  get <path>          a single value, e.g. identity.productName
  shell               APP_CONFIG_* assignments for bash eval
  github-env          APP_CONFIG_* lines for $GITHUB_ENV
  check               validate app.config.ts and exit`;

/** Run a command against a raw config; returns the text to print. */
export function run(argv: readonly string[], raw: unknown = rawAppConfig): string {
  const config = validateAppConfig(raw);
  const [command, argument] = argv;
  switch (command) {
    case "port":
      return String(config.runtime.ports[appArgument(argument)]);
    case "origin":
      return localOrigin(config, appArgument(argument));
    case "get": {
      const value = argument ? lookup(config, argument) : undefined;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      throw new UsageError(`${argument ?? "(no path)"} is not a single value in app.config.ts`);
    }
    case "shell":
      return Object.entries(configVariables(config))
        .map(([name, value]) => `${name}=${shellQuote(value)}`)
        .join("\n");
    case "github-env":
      return Object.entries(configVariables(config))
        .map(([name, value]) => `${name}=${value}`)
        .join("\n");
    case "check":
      return "app.config.ts is valid";
    default:
      throw new UsageError(command ? `unknown command: ${command}` : "no command given");
  }
}

export function main(argv: readonly string[]): number {
  try {
    process.stdout.write(`${run(argv)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof AppConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    if (error instanceof UsageError) {
      process.stderr.write(`app-config: ${error.message}\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }
}

// Run as a script (not imported by a test). Real paths, as the module URL is
// one: the checkout may sit behind a symlink such as macOS's /var -> /private/var.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
