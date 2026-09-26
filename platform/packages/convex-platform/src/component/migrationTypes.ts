import { v } from "convex/values";
import { auditTrailFields, appSettingsFields, announcementFields, waitlistEntriesFields, invitationTokensFields, adminInvitationsFields } from "./schema";

export { migrationTables, migrationTableValidator } from "./migrationTables";
export type { MigrationTable } from "./migrationTables";

export const legacyFields = {
  auditTrail: auditTrailFields,
  appSettings: appSettingsFields,
  adminEmails: { email: v.string() },
  waitlistEntries: waitlistEntriesFields,
  invitationTokens: { ...invitationTokensFields, waitlistEntryId: v.string() },
  adminInvitations: adminInvitationsFields,
  announcements: { ...announcementFields, publishJobId: v.optional(v.string()), unpublishJobId: v.optional(v.string()) },
};

export const legacyDocument = {
  waitlistEntries: v.object({ _id: v.string(), _creationTime: v.number(), ...legacyFields.waitlistEntries }),
  invitationTokens: v.object({ _id: v.string(), _creationTime: v.number(), ...legacyFields.invitationTokens }),
  adminInvitations: v.object({ _id: v.string(), _creationTime: v.number(), ...legacyFields.adminInvitations }),
  adminEmails: v.object({ _id: v.string(), _creationTime: v.number(), ...legacyFields.adminEmails }),
  appSettings: v.object({ _id: v.string(), _creationTime: v.number(), ...legacyFields.appSettings }),
  announcements: v.object({ _id: v.string(), _creationTime: v.number(), ...legacyFields.announcements }),
  auditTrail: v.object({ _id: v.string(), _creationTime: v.number(), ...legacyFields.auditTrail }),
};

export { snapshot } from "./migrationSnapshot";
