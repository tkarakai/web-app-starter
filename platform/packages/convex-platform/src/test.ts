/// <reference types="vite/client" />
/**
 * convex-test helper: registers the platform component in an app's test env.
 *
 * ```ts
 * import { registerPlatform } from "@web-app-starter/convex-platform/test";
 * const t = convexTest(schema, modules);
 * registerPlatform(t);
 * ```
 */
import type { TestConvex } from "convex-test";

import schema from "./component/schema";

const modules = import.meta.glob("./component/**/*.ts");

export { schema as platformSchema, modules as platformModules };

export function registerPlatform(
  t: Pick<TestConvex<never>, "registerComponent">,
  name = "platform",
): void {
  t.registerComponent(name, schema, modules);
}
