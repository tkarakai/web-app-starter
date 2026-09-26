/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as announcements from "../announcements.js";
import type * as appSettings from "../appSettings.js";
import type * as auditTrail from "../auditTrail.js";
import type * as auditTrailConstants from "../auditTrailConstants.js";
import type * as auditTrailHelpers from "../auditTrailHelpers.js";
import type * as inputLimits from "../inputLimits.js";
import type * as onboardingType from "../onboardingType.js";
import type * as securityPolicies from "../securityPolicies.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  announcements: typeof announcements;
  appSettings: typeof appSettings;
  auditTrail: typeof auditTrail;
  auditTrailConstants: typeof auditTrailConstants;
  auditTrailHelpers: typeof auditTrailHelpers;
  inputLimits: typeof inputLimits;
  onboardingType: typeof onboardingType;
  securityPolicies: typeof securityPolicies;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
