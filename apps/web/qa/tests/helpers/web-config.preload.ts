import { mock } from "bun:test";
import * as original from "@web-app-starter/app-config";

// Only loaded in a child process: never replace the shared checkout's configuration.
const variant = JSON.parse(process.env.WEB_QA_CONFIG_VARIANT ?? "{}") as {
  i18n?: original.AppConfig["i18n"];
  waitlist?: boolean;
};
const appConfig = original.validateAppConfig({
  ...original.appConfig,
  i18n: variant.i18n ?? original.appConfig.i18n,
  features: { ...original.appConfig.features, waitlist: variant.waitlist ?? original.appConfig.features.waitlist },
});

mock.module("@web-app-starter/app-config", () => ({
  ...original,
  appConfig,
  localAppOrigin: (app: original.AppId) => original.localOrigin(appConfig, app),
}));
