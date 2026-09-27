import { v } from "convex/values";
export const migrationTables = ["announcements", "appSettings", "adminEmails", "waitlistEntries", "invitationTokens", "adminInvitations", "auditTrail"] as const;
export type MigrationTable = typeof migrationTables[number];
export const migrationTableValidator = v.union(...migrationTables.map(table => v.literal(table)));
export const MIGRATION_NAME = "v2-component-data";
export const migrationPhaseValidator = v.union(v.literal("copying"), v.literal("verified"), v.literal("activating"), v.literal("complete"));
