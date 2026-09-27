/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminEmails from "../adminEmails.js";
import type * as adminInvitations from "../adminInvitations.js";
import type * as announcements from "../announcements.js";
import type * as appSettings from "../appSettings.js";
import type * as auditTrail from "../auditTrail.js";
import type * as auditTrailConstants from "../auditTrailConstants.js";
import type * as auditTrailHelpers from "../auditTrailHelpers.js";
import type * as functions from "../functions.js";
import type * as inputLimits from "../inputLimits.js";
import type * as invitationFixtures from "../invitationFixtures.js";
import type * as migration from "../migration.js";
import type * as migrationGuard from "../migrationGuard.js";
import type * as migrationImport from "../migrationImport.js";
import type * as migrationShared from "../migrationShared.js";
import type * as migrationSnapshot from "../migrationSnapshot.js";
import type * as migrationTables from "../migrationTables.js";
import type * as migrationTypes from "../migrationTypes.js";
import type * as onboardingType from "../onboardingType.js";
import type * as securityPolicies from "../securityPolicies.js";
import type * as tokenHash from "../tokenHash.js";
import type * as waitlist from "../waitlist.js";
import type * as waitlistBootstrap from "../waitlistBootstrap.js";
import type * as waitlistTokens from "../waitlistTokens.js";
import type * as waitlistValidation from "../waitlistValidation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  adminEmails: typeof adminEmails;
  adminInvitations: typeof adminInvitations;
  announcements: typeof announcements;
  appSettings: typeof appSettings;
  auditTrail: typeof auditTrail;
  auditTrailConstants: typeof auditTrailConstants;
  auditTrailHelpers: typeof auditTrailHelpers;
  functions: typeof functions;
  inputLimits: typeof inputLimits;
  invitationFixtures: typeof invitationFixtures;
  migration: typeof migration;
  migrationGuard: typeof migrationGuard;
  migrationImport: typeof migrationImport;
  migrationShared: typeof migrationShared;
  migrationSnapshot: typeof migrationSnapshot;
  migrationTables: typeof migrationTables;
  migrationTypes: typeof migrationTypes;
  onboardingType: typeof onboardingType;
  securityPolicies: typeof securityPolicies;
  tokenHash: typeof tokenHash;
  waitlist: typeof waitlist;
  waitlistBootstrap: typeof waitlistBootstrap;
  waitlistTokens: typeof waitlistTokens;
  waitlistValidation: typeof waitlistValidation;
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
