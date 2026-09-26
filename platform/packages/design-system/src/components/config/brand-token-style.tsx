/**
 * Applies an app's design-token overrides (`brand.tokenOverrides` in
 * app.config.ts) on top of the design system's tokens.
 *
 * Render it in the root layout's `<body>`, after the global stylesheet has
 * loaded, with `tokenOverrideCss(appConfig)` from `@repo/app-config`. It is a
 * `:root` rule placed after the token stylesheet, so an override applies in
 * both the light and the dark theme. The CSS is built from validated values
 * only (see `packages/app-config/src/schema.ts`); nothing here escapes it.
 */
export function BrandTokenStyle({ css }: { css: string }) {
  if (!css) return null;
  return <style data-brand-tokens="">{css}</style>;
}
