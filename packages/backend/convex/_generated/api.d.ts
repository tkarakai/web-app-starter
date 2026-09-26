/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as platform_adminAuth from "../platform/adminAuth.js";
import type * as platform_adminEmails from "../platform/adminEmails.js";
import type * as platform_adminInvitationActions from "../platform/adminInvitationActions.js";
import type * as platform_adminInvitations from "../platform/adminInvitations.js";
import type * as platform_announcements from "../platform/announcements.js";
import type * as platform_appSettings from "../platform/appSettings.js";
import type * as platform_auditTrail from "../platform/auditTrail.js";
import type * as platform_auditTrailConstants from "../platform/auditTrailConstants.js";
import type * as platform_auditTrailHelpers from "../platform/auditTrailHelpers.js";
import type * as platform_auth from "../platform/auth.js";
import type * as platform_bootstrap from "../platform/bootstrap.js";
import type * as platform_devSeed from "../platform/devSeed.js";
import type * as platform_devTotp from "../platform/devTotp.js";
import type * as platform_developmentOnly from "../platform/developmentOnly.js";
import type * as platform_e2eFixtures from "../platform/e2eFixtures.js";
import type * as platform_emailTemplates from "../platform/emailTemplates.js";
import type * as platform_functions from "../platform/functions.js";
import type * as platform_httpRoutes from "../platform/httpRoutes.js";
import type * as platform_integrations from "../platform/integrations.js";
import type * as platform_meta from "../platform/meta.js";
import type * as platform_onboardingType from "../platform/onboardingType.js";
import type * as platform_parseUserAgent from "../platform/parseUserAgent.js";
import type * as platform_passwordStrength from "../platform/passwordStrength.js";
import type * as platform_rateLimits from "../platform/rateLimits.js";
import type * as platform_securityPolicies from "../platform/securityPolicies.js";
import type * as platform_sendAuthEmail from "../platform/sendAuthEmail.js";
import type * as platform_sessions from "../platform/sessions.js";
import type * as platform_tables from "../platform/tables.js";
import type * as platform_tokenHash from "../platform/tokenHash.js";
import type * as platform_userProfiles from "../platform/userProfiles.js";
import type * as platform_waitlist from "../platform/waitlist.js";
import type * as platform_waitlistActions from "../platform/waitlistActions.js";
import type * as platform_waitlistTokens from "../platform/waitlistTokens.js";
import type * as projectAccess from "../projectAccess.js";
import type * as projects from "../projects.js";
import type * as sampleTables from "../sampleTables.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  files: typeof files;
  http: typeof http;
  migrations: typeof migrations;
  "platform/adminAuth": typeof platform_adminAuth;
  "platform/adminEmails": typeof platform_adminEmails;
  "platform/adminInvitationActions": typeof platform_adminInvitationActions;
  "platform/adminInvitations": typeof platform_adminInvitations;
  "platform/announcements": typeof platform_announcements;
  "platform/appSettings": typeof platform_appSettings;
  "platform/auditTrail": typeof platform_auditTrail;
  "platform/auditTrailConstants": typeof platform_auditTrailConstants;
  "platform/auditTrailHelpers": typeof platform_auditTrailHelpers;
  "platform/auth": typeof platform_auth;
  "platform/bootstrap": typeof platform_bootstrap;
  "platform/devSeed": typeof platform_devSeed;
  "platform/devTotp": typeof platform_devTotp;
  "platform/developmentOnly": typeof platform_developmentOnly;
  "platform/e2eFixtures": typeof platform_e2eFixtures;
  "platform/emailTemplates": typeof platform_emailTemplates;
  "platform/functions": typeof platform_functions;
  "platform/httpRoutes": typeof platform_httpRoutes;
  "platform/integrations": typeof platform_integrations;
  "platform/meta": typeof platform_meta;
  "platform/onboardingType": typeof platform_onboardingType;
  "platform/parseUserAgent": typeof platform_parseUserAgent;
  "platform/passwordStrength": typeof platform_passwordStrength;
  "platform/rateLimits": typeof platform_rateLimits;
  "platform/securityPolicies": typeof platform_securityPolicies;
  "platform/sendAuthEmail": typeof platform_sendAuthEmail;
  "platform/sessions": typeof platform_sessions;
  "platform/tables": typeof platform_tables;
  "platform/tokenHash": typeof platform_tokenHash;
  "platform/userProfiles": typeof platform_userProfiles;
  "platform/waitlist": typeof platform_waitlist;
  "platform/waitlistActions": typeof platform_waitlistActions;
  "platform/waitlistTokens": typeof platform_waitlistTokens;
  projectAccess: typeof projectAccess;
  projects: typeof projects;
  sampleTables: typeof sampleTables;
  tasks: typeof tasks;
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
  betterAuth: import("../platform/betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
