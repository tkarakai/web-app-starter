import { httpRouter } from "convex/server";

import { registerPlatformRoutes } from "./platform/httpRoutes";

// A seam: the app's HTTP routes plus the platform hook. Add your own
// `http.route(...)` calls after the platform's; keep `registerPlatformRoutes`.
const http = httpRouter();

// Platform hook: Better Auth, waitlist, session and dev/E2E routes.
registerPlatformRoutes(http);

export default http;
