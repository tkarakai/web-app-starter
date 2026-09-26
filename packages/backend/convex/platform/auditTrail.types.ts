// Typecheck-only contract. A missing component.js export otherwise degrades to
// `any` inside generated declarations because skipLibCheck hides that error.
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { ComponentApi } from "@web-app-starter/convex-platform/_generated/component.js";
import type { api, components } from "../_generated/api";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type Component = typeof components.platform;
type Insert = FunctionArgs<Component["auditTrail"]["insertEvent"]>;
type Page = FunctionReturnType<typeof api.platform.auditTrail.list>;

export type AuditTrailTypeContract = [
  Assert<Component extends ComponentApi<"platform"> ? true : false>,
  Assert<IsAny<Component> extends false ? true : false>,
  Assert<IsAny<Insert> extends false ? true : false>,
  Assert<IsAny<Page["page"][number]> extends false ? true : false>,
  Assert<Page["page"][number]["_id"] extends string ? true : false>,
  Assert<Insert["actor"] extends string ? true : false>,
];
