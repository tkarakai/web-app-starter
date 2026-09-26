import { defineApp } from "convex/server";
import { v } from "convex/values";
import platform from "@repo/convex-platform/convex.config";
import betterAuth from "./betterAuth/convex.config";

// SPIKE: the app declares the env it forwards to the platform component, so a
// deploy without SITE_URL fails before any function runs.
const app = defineApp({
  env: {
    SITE_URL: v.string(),
    AUDIT_TRAIL_RETENTION_DAYS: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(platform, {
  env: {
    // By reference: the component follows the deployment value when it changes.
    SITE_URL: app.env.SITE_URL,
    AUDIT_TRAIL_RETENTION_DAYS: app.env.AUDIT_TRAIL_RETENTION_DAYS,
  },
});

export default app;
