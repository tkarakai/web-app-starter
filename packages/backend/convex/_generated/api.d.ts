/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminAuth from "../adminAuth.js";
import type * as adminEmails from "../adminEmails.js";
import type * as adminInvitationActions from "../adminInvitationActions.js";
import type * as adminInvitations from "../adminInvitations.js";
import type * as announcements from "../announcements.js";
import type * as appSettings from "../appSettings.js";
import type * as auth from "../auth.js";
import type * as bootstrap from "../bootstrap.js";
import type * as devSeed from "../devSeed.js";
import type * as devTotp from "../devTotp.js";
import type * as e2eFixtures from "../e2eFixtures.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as files from "../files.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as meta from "../meta.js";
import type * as migrations from "../migrations.js";
import type * as onboardingType from "../onboardingType.js";
import type * as parseUserAgent from "../parseUserAgent.js";
import type * as passwordStrength from "../passwordStrength.js";
import type * as platform_auditTrail from "../platform/auditTrail.js";
import type * as platform_auditTrailHelpers from "../platform/auditTrailHelpers.js";
import type * as platform_migrateAuditTrail from "../platform/migrateAuditTrail.js";
import type * as projects from "../projects.js";
import type * as rateLimits from "../rateLimits.js";
import type * as securityPolicies from "../securityPolicies.js";
import type * as sendAuthEmail from "../sendAuthEmail.js";
import type * as sessions from "../sessions.js";
import type * as tasks from "../tasks.js";
import type * as tokenHash from "../tokenHash.js";
import type * as userProfiles from "../userProfiles.js";
import type * as waitlist from "../waitlist.js";
import type * as waitlistActions from "../waitlistActions.js";
import type * as waitlistTokens from "../waitlistTokens.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminAuth: typeof adminAuth;
  adminEmails: typeof adminEmails;
  adminInvitationActions: typeof adminInvitationActions;
  adminInvitations: typeof adminInvitations;
  announcements: typeof announcements;
  appSettings: typeof appSettings;
  auth: typeof auth;
  bootstrap: typeof bootstrap;
  devSeed: typeof devSeed;
  devTotp: typeof devTotp;
  e2eFixtures: typeof e2eFixtures;
  emailTemplates: typeof emailTemplates;
  files: typeof files;
  functions: typeof functions;
  http: typeof http;
  integrations: typeof integrations;
  meta: typeof meta;
  migrations: typeof migrations;
  onboardingType: typeof onboardingType;
  parseUserAgent: typeof parseUserAgent;
  passwordStrength: typeof passwordStrength;
  "platform/auditTrail": typeof platform_auditTrail;
  "platform/auditTrailHelpers": typeof platform_auditTrailHelpers;
  "platform/migrateAuditTrail": typeof platform_migrateAuditTrail;
  projects: typeof projects;
  rateLimits: typeof rateLimits;
  securityPolicies: typeof securityPolicies;
  sendAuthEmail: typeof sendAuthEmail;
  sessions: typeof sessions;
  tasks: typeof tasks;
  tokenHash: typeof tokenHash;
  userProfiles: typeof userProfiles;
  waitlist: typeof waitlist;
  waitlistActions: typeof waitlistActions;
  waitlistTokens: typeof waitlistTokens;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  platform: import("@repo/convex-platform/_generated/component.js").ComponentApi<"platform">;
};
