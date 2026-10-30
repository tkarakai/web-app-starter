/** App-owned dispositions. Adding a table/function/job requires an explicit reviewed entry. */
import type { OrganizationMigrationRegistry } from "./platform/organizationMigrationRegistry";
const operations = (module: string, names: string[], disposition: OrganizationMigrationRegistry["functions"][string]) =>
  Object.fromEntries(names.map(name => [`${module}:${name}`, disposition]));
export const organizationMigrationRegistry: OrganizationMigrationRegistry = {
  version: 1,
  tables: {
    projects: "private-root", tasks: "private-child", uploads: "private-child", userProfiles: "identity-private",
    agentAuthorizationCodes: "authority-retire", agentGrants: "authority-retire", agentDelegations: "authority-retire",
    agentTasks: "artifact-quarantine", agentTaskMessages: "artifact-quarantine",
    migrations: "migration-bookkeeping", organizationMigrationState: "migration-bookkeeping",
    organizationOwnerMappings: "migration-bookkeeping", organizationMigrationDispositions: "migration-bookkeeping",
    rateLimits: "platform-control",
  },
  functions: {
    "http:default": "platform-control",
    // Conservative source inventory also binds exported data used by handlers.
    "files:ALLOWED_CONTENT_TYPES": "platform-control",
    "sampleTables:sampleTables": "migration-internal",
    "organizationMigration:organizationMigrationStages": "migration-internal",
    ...operations("projects", ["list", "listWithStats", "get", "create", "update", "remove"], "legacy-retired"),
    ...operations("tasks", ["listByProject", "create", "update", "remove"], "legacy-retired"),
    ...operations("files", ["generateUploadUrl", "saveUpload", "beginUpload", "finishUpload", "discardUnattachedUpload", "uploadFile", "authorizeDownload", "downloadFile", "listUploads", "deleteUpload", "inventoryLegacyUploads"], "legacy-retired"),
    ...operations("tenantProjects", ["list", "listWithStats", "get", "create", "update", "remove"], "tenant"),
    ...operations("tenantTasks", ["listByProject", "create", "update", "remove"], "tenant"),
    ...operations("tenantFiles", ["beginUpload", "finishUpload", "uploadFile", "authorizeDownload", "downloadFile", "listUploads", "deleteUpload"], "tenant"),
    ...operations("organizationMigration", ["begin", "step", "finalize", "status", "maintenance", "recoverForward"], "migration-internal"),
    ...operations("migrations", ["default", "organizationCutover"], "migration-internal"),
  },
  jobs: {
    "platform/agentTasks:work": "epoch-control",
    "platform/agentTasks:recover": "epoch-control",
    "platform/agentTasks:expire": "epoch-control",
    "platform/agentAccess:expireCode": "epoch-control",
    "platform/agentAccess:expireGrant": "epoch-control",
    "platform/agentAccess:expireDelegation": "epoch-control",
    "platform/auditTrail:insertEvent": "preserve-control",
    "platform/waitlistActions:generateTokenAndSendEmail": "preserve-control",
    "platform/adminInvitationActions:generateTokenAndSendEmail": "preserve-control",
    "platform/memberInvitationDelivery:send": "drain",
  },
  components: {
    betterAuth: "canonical-identities-credentials-sessions-memberships-preserved;identity-mapping-v1",
    platform: "control-settings-announcements-admission-preserved;audit-projection-or-private-quarantine-v1",
    agentInterfaces: "mcp-cli-a2a-webmcp-operator-only;epoch-2;reconsent-and-artifact-quarantine",
  },
};
