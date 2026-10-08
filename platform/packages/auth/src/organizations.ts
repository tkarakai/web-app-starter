import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/** Organization authority never grants Better Auth's global administrator role. */
export const organizationAccess = createAccessControl(defaultStatements);
export const organizationRoles = {
  "org-admin": organizationAccess.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  member: organizationAccess.newRole({}),
};

/** Defaults shared by the real auth factory and its schema-generation configuration. */
export const organizationDefaults = {
  ac: organizationAccess,
  roles: organizationRoles,
  creatorRole: "org-admin",
  allowUserToCreateOrganization: false,
  disableOrganizationDeletion: true,
  requireEmailVerificationOnInvitation: true,
  membershipLimit: 100,
  schema: {
    organization: {
      additionalFields: {
        experience: { type: "string", required: false, input: false },
        lifecycle: { type: "string", required: false, input: false },
        personalOwnerId: { type: "string", required: false, input: false },
      },
    },
    member: {
      additionalFields: {
        adminEnrolledAt: { type: "number", required: false, input: false },
        adminFactorId: { type: "string", required: false, input: false },
      },
    },
    invitation: {
      additionalFields: {
        intendedRole: { type: "string", required: false, input: false },
      },
    },
  },
} as const;
