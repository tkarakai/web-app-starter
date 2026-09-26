import { defineApp } from "convex/server";
import betterAuth from "./platform/betterAuth/convex.config";

import platform from "@web-app-starter/convex-platform/convex.config";

const app = defineApp();
app.use(betterAuth);
app.use(platform);

export default app;
