/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapter from "../adapter.js";
import type * as appOperators from "../appOperators.js";
import type * as auth from "../auth.js";
import type * as memberInvitationModel from "../memberInvitationModel.js";
import type * as memberInvitations from "../memberInvitations.js";
import type * as organizationAudit from "../organizationAudit.js";
import type * as organizationMigration from "../organizationMigration.js";
import type * as organizationMigrationBarrier from "../organizationMigrationBarrier.js";
import type * as organizationModel from "../organizationModel.js";
import type * as organizationSecurity from "../organizationSecurity.js";
import type * as organizationSecurityGuard from "../organizationSecurityGuard.js";
import type * as organizationVocabulary from "../organizationVocabulary.js";
import type * as organizations from "../organizations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  adapter: typeof adapter;
  appOperators: typeof appOperators;
  auth: typeof auth;
  memberInvitationModel: typeof memberInvitationModel;
  memberInvitations: typeof memberInvitations;
  organizationAudit: typeof organizationAudit;
  organizationMigration: typeof organizationMigration;
  organizationMigrationBarrier: typeof organizationMigrationBarrier;
  organizationModel: typeof organizationModel;
  organizationSecurity: typeof organizationSecurity;
  organizationSecurityGuard: typeof organizationSecurityGuard;
  organizationVocabulary: typeof organizationVocabulary;
  organizations: typeof organizations;
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
