// ESLint configuration for the whole repository. The rules come from the
// platform base (platform/config/eslint.base.mjs); add app-specific entries
// after it.
import platform from "./platform/config/eslint.base.mjs";

export default [
  ...platform,
  {
    // The demo's consumed starter package and its release fixtures are
    // generated artifacts, not source.
    ignores: ["apps/demo/starter-packages/**", "apps/demo/qa/fixtures/starter-releases/**"],
  },
];
