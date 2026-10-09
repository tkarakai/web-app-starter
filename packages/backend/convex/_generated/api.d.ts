/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as fileAccess from "../fileAccess.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as organizationMigration from "../organizationMigration.js";
import type * as organizationMigrationRegistry from "../organizationMigrationRegistry.js";
import type * as platform_adminAuth from "../platform/adminAuth.js";
import type * as platform_adminEmails from "../platform/adminEmails.js";
import type * as platform_adminInvitationActions from "../platform/adminInvitationActions.js";
import type * as platform_adminInvitations from "../platform/adminInvitations.js";
import type * as platform_agentAccess from "../platform/agentAccess.js";
import type * as platform_agentCapabilities from "../platform/agentCapabilities.js";
import type * as platform_agentContract from "../platform/agentContract.js";
import type * as platform_agentExposure from "../platform/agentExposure.js";
import type * as platform_agentNativePolicy from "../platform/agentNativePolicy.js";
import type * as platform_agentProof from "../platform/agentProof.js";
import type * as platform_agentRegistry from "../platform/agentRegistry.js";
import type * as platform_agentSurfaces from "../platform/agentSurfaces.js";
import type * as platform_agentTaskAdmin from "../platform/agentTaskAdmin.js";
import type * as platform_agentTaskModel from "../platform/agentTaskModel.js";
import type * as platform_agentTasks from "../platform/agentTasks.js";
import type * as platform_agentUsers from "../platform/agentUsers.js";
import type * as platform_announcements from "../platform/announcements.js";
import type * as platform_appOperatorAccess from "../platform/appOperatorAccess.js";
import type * as platform_appOperatorAuditCompatibility from "../platform/appOperatorAuditCompatibility.js";
import type * as platform_appOperatorDirectory from "../platform/appOperatorDirectory.js";
import type * as platform_appOperatorIdentity from "../platform/appOperatorIdentity.js";
import type * as platform_appSettings from "../platform/appSettings.js";
import type * as platform_auditPrivacy from "../platform/auditPrivacy.js";
import type * as platform_auditTrail from "../platform/auditTrail.js";
import type * as platform_auditTrailConstants from "../platform/auditTrailConstants.js";
import type * as platform_auditTrailHelpers from "../platform/auditTrailHelpers.js";
import type * as platform_auth from "../platform/auth.js";
import type * as platform_authAssurance from "../platform/authAssurance.js";
import type * as platform_authRateLimits from "../platform/authRateLimits.js";
import type * as platform_bootstrap from "../platform/bootstrap.js";
import type * as platform_componentMigration from "../platform/componentMigration.js";
import type * as platform_componentMigrationLegacy from "../platform/componentMigrationLegacy.js";
import type * as platform_customerAdmissionFields from "../platform/customerAdmissionFields.js";
import type * as platform_devSeed from "../platform/devSeed.js";
import type * as platform_devTotp from "../platform/devTotp.js";
import type * as platform_developmentOnly from "../platform/developmentOnly.js";
import type * as platform_e2eFixtures from "../platform/e2eFixtures.js";
import type * as platform_emailTemplates from "../platform/emailTemplates.js";
import type * as platform_functions from "../platform/functions.js";
import type * as platform_httpRoutes from "../platform/httpRoutes.js";
import type * as platform_integrations from "../platform/integrations.js";
import type * as platform_localFixtures from "../platform/localFixtures.js";
import type * as platform_memberInvitationDelivery from "../platform/memberInvitationDelivery.js";
import type * as platform_memberInvitations from "../platform/memberInvitations.js";
import type * as platform_memberManagement from "../platform/memberManagement.js";
import type * as platform_meta from "../platform/meta.js";
import type * as platform_nativeCapabilities from "../platform/nativeCapabilities.js";
import type * as platform_onboardingType from "../platform/onboardingType.js";
import type * as platform_operatorAccess from "../platform/operatorAccess.js";
import type * as platform_operatorIdentity from "../platform/operatorIdentity.js";
import type * as platform_organizationEnrollment from "../platform/organizationEnrollment.js";
import type * as platform_organizationFactorReplacement from "../platform/organizationFactorReplacement.js";
import type * as platform_organizationMigration from "../platform/organizationMigration.js";
import type * as platform_organizationMigrationRegistry from "../platform/organizationMigrationRegistry.js";
import type * as platform_organizationMigrationSchema from "../platform/organizationMigrationSchema.js";
import type * as platform_organizationPolicy from "../platform/organizationPolicy.js";
import type * as platform_organizationReadiness from "../platform/organizationReadiness.js";
import type * as platform_organizationTotp from "../platform/organizationTotp.js";
import type * as platform_organizations from "../platform/organizations.js";
import type * as platform_parseUserAgent from "../platform/parseUserAgent.js";
import type * as platform_passwordStrength from "../platform/passwordStrength.js";
import type * as platform_rateLimits from "../platform/rateLimits.js";
import type * as platform_recoveryCodes from "../platform/recoveryCodes.js";
import type * as platform_securityPolicies from "../platform/securityPolicies.js";
import type * as platform_sendAuthEmail from "../platform/sendAuthEmail.js";
import type * as platform_sessionAssurance from "../platform/sessionAssurance.js";
import type * as platform_sessionFields from "../platform/sessionFields.js";
import type * as platform_sessionPolicy from "../platform/sessionPolicy.js";
import type * as platform_sessions from "../platform/sessions.js";
import type * as platform_tables from "../platform/tables.js";
import type * as platform_tenantContext from "../platform/tenantContext.js";
import type * as platform_tenantFunctions from "../platform/tenantFunctions.js";
import type * as platform_tokenHash from "../platform/tokenHash.js";
import type * as platform_userProfiles from "../platform/userProfiles.js";
import type * as platform_waitlist from "../platform/waitlist.js";
import type * as platform_waitlistActions from "../platform/waitlistActions.js";
import type * as platform_waitlistTokens from "../platform/waitlistTokens.js";
import type * as projectAccess from "../projectAccess.js";
import type * as projects from "../projects.js";
import type * as sampleTables from "../sampleTables.js";
import type * as tasks from "../tasks.js";
import type * as tenantAccess from "../tenantAccess.js";
import type * as tenantFiles from "../tenantFiles.js";
import type * as tenantProjects from "../tenantProjects.js";
import type * as tenantTasks from "../tenantTasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  fileAccess: typeof fileAccess;
  files: typeof files;
  http: typeof http;
  migrations: typeof migrations;
  organizationMigration: typeof organizationMigration;
  organizationMigrationRegistry: typeof organizationMigrationRegistry;
  "platform/adminAuth": typeof platform_adminAuth;
  "platform/adminEmails": typeof platform_adminEmails;
  "platform/adminInvitationActions": typeof platform_adminInvitationActions;
  "platform/adminInvitations": typeof platform_adminInvitations;
  "platform/agentAccess": typeof platform_agentAccess;
  "platform/agentCapabilities": typeof platform_agentCapabilities;
  "platform/agentContract": typeof platform_agentContract;
  "platform/agentExposure": typeof platform_agentExposure;
  "platform/agentNativePolicy": typeof platform_agentNativePolicy;
  "platform/agentProof": typeof platform_agentProof;
  "platform/agentRegistry": typeof platform_agentRegistry;
  "platform/agentSurfaces": typeof platform_agentSurfaces;
  "platform/agentTaskAdmin": typeof platform_agentTaskAdmin;
  "platform/agentTaskModel": typeof platform_agentTaskModel;
  "platform/agentTasks": typeof platform_agentTasks;
  "platform/agentUsers": typeof platform_agentUsers;
  "platform/announcements": typeof platform_announcements;
  "platform/appOperatorAccess": typeof platform_appOperatorAccess;
  "platform/appOperatorAuditCompatibility": typeof platform_appOperatorAuditCompatibility;
  "platform/appOperatorDirectory": typeof platform_appOperatorDirectory;
  "platform/appOperatorIdentity": typeof platform_appOperatorIdentity;
  "platform/appSettings": typeof platform_appSettings;
  "platform/auditPrivacy": typeof platform_auditPrivacy;
  "platform/auditTrail": typeof platform_auditTrail;
  "platform/auditTrailConstants": typeof platform_auditTrailConstants;
  "platform/auditTrailHelpers": typeof platform_auditTrailHelpers;
  "platform/auth": typeof platform_auth;
  "platform/authAssurance": typeof platform_authAssurance;
  "platform/authRateLimits": typeof platform_authRateLimits;
  "platform/bootstrap": typeof platform_bootstrap;
  "platform/componentMigration": typeof platform_componentMigration;
  "platform/componentMigrationLegacy": typeof platform_componentMigrationLegacy;
  "platform/customerAdmissionFields": typeof platform_customerAdmissionFields;
  "platform/devSeed": typeof platform_devSeed;
  "platform/devTotp": typeof platform_devTotp;
  "platform/developmentOnly": typeof platform_developmentOnly;
  "platform/e2eFixtures": typeof platform_e2eFixtures;
  "platform/emailTemplates": typeof platform_emailTemplates;
  "platform/functions": typeof platform_functions;
  "platform/httpRoutes": typeof platform_httpRoutes;
  "platform/integrations": typeof platform_integrations;
  "platform/localFixtures": typeof platform_localFixtures;
  "platform/memberInvitationDelivery": typeof platform_memberInvitationDelivery;
  "platform/memberInvitations": typeof platform_memberInvitations;
  "platform/memberManagement": typeof platform_memberManagement;
  "platform/meta": typeof platform_meta;
  "platform/nativeCapabilities": typeof platform_nativeCapabilities;
  "platform/onboardingType": typeof platform_onboardingType;
  "platform/operatorAccess": typeof platform_operatorAccess;
  "platform/operatorIdentity": typeof platform_operatorIdentity;
  "platform/organizationEnrollment": typeof platform_organizationEnrollment;
  "platform/organizationFactorReplacement": typeof platform_organizationFactorReplacement;
  "platform/organizationMigration": typeof platform_organizationMigration;
  "platform/organizationMigrationRegistry": typeof platform_organizationMigrationRegistry;
  "platform/organizationMigrationSchema": typeof platform_organizationMigrationSchema;
  "platform/organizationPolicy": typeof platform_organizationPolicy;
  "platform/organizationReadiness": typeof platform_organizationReadiness;
  "platform/organizationTotp": typeof platform_organizationTotp;
  "platform/organizations": typeof platform_organizations;
  "platform/parseUserAgent": typeof platform_parseUserAgent;
  "platform/passwordStrength": typeof platform_passwordStrength;
  "platform/rateLimits": typeof platform_rateLimits;
  "platform/recoveryCodes": typeof platform_recoveryCodes;
  "platform/securityPolicies": typeof platform_securityPolicies;
  "platform/sendAuthEmail": typeof platform_sendAuthEmail;
  "platform/sessionAssurance": typeof platform_sessionAssurance;
  "platform/sessionFields": typeof platform_sessionFields;
  "platform/sessionPolicy": typeof platform_sessionPolicy;
  "platform/sessions": typeof platform_sessions;
  "platform/tables": typeof platform_tables;
  "platform/tenantContext": typeof platform_tenantContext;
  "platform/tenantFunctions": typeof platform_tenantFunctions;
  "platform/tokenHash": typeof platform_tokenHash;
  "platform/userProfiles": typeof platform_userProfiles;
  "platform/waitlist": typeof platform_waitlist;
  "platform/waitlistActions": typeof platform_waitlistActions;
  "platform/waitlistTokens": typeof platform_waitlistTokens;
  projectAccess: typeof projectAccess;
  projects: typeof projects;
  sampleTables: typeof sampleTables;
  tasks: typeof tasks;
  tenantAccess: typeof tenantAccess;
  tenantFiles: typeof tenantFiles;
  tenantProjects: typeof tenantProjects;
  tenantTasks: typeof tenantTasks;
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
  platform: import("@web-app-starter/convex-platform/_generated/component.js").ComponentApi<"platform">;
};
