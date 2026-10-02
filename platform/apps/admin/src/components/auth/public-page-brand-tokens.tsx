import { BrandTokenStyle } from "@web-app-starter/design-system";
import {
  ADMIN_PUBLIC_SCOPE,
  appConfig as defaultConfig,
  tokenOverrideCss,
  type AppConfig,
} from "@web-app-starter/app-config";

/**
 * The `"admin-public"` token overrides of `brand.tokenOverrides` (app.config.ts), for the admin's
 * public pages: sign-in, forgot and reset password, onboarding. Their layouts render it, so it
 * lands after the root layout's admin tokens and wins for the tokens both set, and it leaves the
 * page (and the dashboard never has it) when the route group is left.
 */
export function PublicPageBrandTokens({ config = defaultConfig }: { config?: AppConfig }) {
  return <BrandTokenStyle css={tokenOverrideCss(config, ADMIN_PUBLIC_SCOPE)} />;
}
