/**
 * The validated app configuration, for every TypeScript consumer: Next.js
 * server, edge and client code, Convex functions, Playwright configs and tests.
 *
 * The values live in the repository root's `app.config.ts`, which the app owns.
 * Validation runs once, when this module loads; an invalid value throws an
 * `AppConfigError` naming each bad setting.
 */
import rawAppConfig from "../../../app.config.ts";
import { type AppConfig, type AppId, localOrigin, validateAppConfig } from "./schema.ts";

export const appConfig: AppConfig = validateAppConfig(rawAppConfig);

/** `http://localhost:<port>` for an app, from `runtime.ports`. */
export function localAppOrigin(app: AppId): string {
  return localOrigin(appConfig, app);
}

export {
  APP_IDS,
  AppConfigError,
  localOrigin,
  tokenOverrideCss,
  validateAppConfig,
  type AppConfig,
  type AppId,
  type EmailPalette,
  type FeatureSwitches,
} from "./schema.ts";
