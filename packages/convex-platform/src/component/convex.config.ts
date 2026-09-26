import { defineComponent } from "convex/server";
import { v } from "convex/values";

/**
 * SPIKE: the platform component.
 *
 * Declared env is the only way a component can read configuration: a component
 * does not see the deployment's environment variables, only the ones it
 * declares here and the installing app passes in `app.use(platform, { env })`.
 *
 * - `SITE_URL` is required, so it is the test case for "a release declares its
 *   required env and deploy fails if it is missing".
 * - `AUDIT_TRAIL_RETENTION_DAYS` is optional, so it is the test case for an
 *   optional platform setting with a default.
 */
const component = defineComponent("platform", {
  env: {
    SITE_URL: v.string(),
    AUDIT_TRAIL_RETENTION_DAYS: v.optional(v.string()),
  },
});

export default component;
