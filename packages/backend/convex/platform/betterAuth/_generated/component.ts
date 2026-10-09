/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    adapter: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                data: {
                  banExpires?: null | number;
                  banReason?: null | string;
                  banned?: null | boolean;
                  createdAt: number;
                  customerAdmission?: null | string;
                  displayUsername?: null | string;
                  email: string;
                  emailVerified: boolean;
                  image?: null | string;
                  isAnonymous?: null | boolean;
                  name: string;
                  phoneNumber?: null | string;
                  phoneNumberVerified?: null | boolean;
                  role?: null | string;
                  twoFactorEnabled?: null | boolean;
                  updatedAt: number;
                  userId?: null | string;
                  username?: null | string;
                };
                model: "user";
              }
            | {
                data: {
                  activeOrganizationId?: null | string;
                  assuranceVersion?: null | number;
                  authMethod?: null | string;
                  authPurpose?: null | string;
                  authenticatedAt?: null | number;
                  createdAt: number;
                  expiresAt: number;
                  impersonatedBy?: null | string;
                  ipAddress?: null | string;
                  primaryVerifiedAt?: null | number;
                  recoveryFactorId?: null | string;
                  recoveryOnly?: null | boolean;
                  recoverySourceFactorId?: null | string;
                  recoverySourceFactorProof?: null | string;
                  strongFactorId?: null | string;
                  strongFactorType?: null | string;
                  strongVerifiedAt?: null | number;
                  token: string;
                  updatedAt: number;
                  userAgent?: null | string;
                  userId: string;
                };
                model: "session";
              }
            | {
                data: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId: string;
                  createdAt: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt: number;
                  userId: string;
                };
                model: "account";
              }
            | {
                data: {
                  createdAt: number;
                  expiresAt: number;
                  identifier: string;
                  updatedAt: number;
                  value: string;
                };
                model: "verification";
              }
            | {
                data: {
                  backupCodes: string;
                  failedVerificationCount?: null | number;
                  lockedUntil?: null | number;
                  secret: string;
                  userId: string;
                  verified?: null | boolean;
                };
                model: "twoFactor";
              }
            | {
                data: {
                  aaguid?: null | string;
                  backedUp: boolean;
                  counter: number;
                  createdAt?: null | number;
                  credentialID: string;
                  deviceType: string;
                  name?: null | string;
                  publicKey: string;
                  transports?: null | string;
                  userId: string;
                };
                model: "passkey";
              }
            | {
                data: {
                  clientId?: null | string;
                  clientSecret?: null | string;
                  createdAt?: null | number;
                  disabled?: null | boolean;
                  icon?: null | string;
                  metadata?: null | string;
                  name?: null | string;
                  redirectUrls?: null | string;
                  type?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                model: "oauthApplication";
              }
            | {
                data: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  clientId?: null | string;
                  createdAt?: null | number;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scopes?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                model: "oauthAccessToken";
              }
            | {
                data: {
                  clientId?: null | string;
                  consentGiven?: null | boolean;
                  createdAt?: null | number;
                  scopes?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                model: "oauthConsent";
              }
            | {
                data: {
                  createdAt: number;
                  experience?: null | string;
                  lifecycle?: null | string;
                  logo?: null | string;
                  metadata?: null | string;
                  name: string;
                  personalOwnerId?: null | string;
                  primaryContactMemberId?: string;
                  slug: string;
                };
                model: "organization";
              }
            | {
                data: {
                  adminEnrolledAt?: null | number;
                  adminFactorId?: null | string;
                  createdAt: number;
                  organizationId: string;
                  role: string;
                  userId: string;
                };
                model: "member";
              }
            | {
                data: {
                  acceptedMemberId?: string;
                  acceptedUserId?: string;
                  createdAt: number;
                  deliveredAt?: number;
                  deliveryError?: string;
                  deliveryState?: "pending" | "sent" | "failed";
                  deliveryVersion?: number;
                  email: string;
                  expiresAt: number;
                  intendedRole?: null | string;
                  inviterId: string;
                  organizationId: string;
                  role?: null | string;
                  status: string;
                  tokenHash?: string;
                };
                model: "invitation";
              }
            | {
                data: {
                  capabilityHash: string;
                  createdAt: number;
                  expiresAt: number;
                  invitationId: string;
                  invitationTokenHash: string;
                  userId?: string;
                };
                model: "organizationInvitationClaims";
              }
            | {
                data: {
                  backupAcknowledgedAt?: number;
                  backupCodesProof?: string;
                  backupFactorId?: string;
                  completedAt?: number;
                  createdAt: number;
                  factorSecretProof?: string;
                  memberId: string;
                  name?: string;
                  organizationId: string;
                  passwordEmail?: string;
                  passwordProof?: string;
                  passwordVerifiedAt?: number;
                  purpose: "collaboration" | "promotion" | "invitation";
                  slug?: string;
                  userId: string;
                };
                model: "organizationEnrollments";
              }
            | {
                data: {
                  key: "admin";
                  passkeyPolicy: "disabled" | "optional" | "required";
                };
                model: "organizationSecurityPolicy";
              }
            | {
                data: {
                  blocked: boolean;
                  deploymentVersion: string;
                  key: "organization-v1";
                };
                model: "organizationMigrationBarrier";
              }
            | {
                data: {
                  backupCodes: string;
                  credentialProof: string;
                  expiresAt: number;
                  factorId: string;
                  factorSecretProof: string;
                  secret: string;
                  sessionId: string;
                  userId: string;
                };
                model: "organizationSecurityChanges";
              }
            | {
                data: {
                  action: string;
                  actorId: string;
                  happenedAt: number;
                  organizationId: string;
                  targetId?: string;
                };
                model: "organizationAudit";
              }
            | {
                data: {
                  createdAt: number;
                  expiresAt?: null | number;
                  privateKey: string;
                  publicKey: string;
                };
                model: "jwks";
              }
            | {
                data: {
                  count?: null | number;
                  key?: null | string;
                  lastRequest?: null | number;
                };
                model: "rateLimit";
              };
          onCreateHandle?: string;
          select?: Array<string>;
        },
        any,
        Name
      >;
      deleteMany: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "twoFactorEnabled"
                    | "isAnonymous"
                    | "username"
                    | "displayUsername"
                    | "phoneNumber"
                    | "phoneNumberVerified"
                    | "userId"
                    | "role"
                    | "customerAdmission"
                    | "banned"
                    | "banReason"
                    | "banExpires"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "impersonatedBy"
                    | "activeOrganizationId"
                    | "authPurpose"
                    | "assuranceVersion"
                    | "authMethod"
                    | "authenticatedAt"
                    | "primaryVerifiedAt"
                    | "strongVerifiedAt"
                    | "strongFactorId"
                    | "strongFactorType"
                    | "recoveryOnly"
                    | "recoveryFactorId"
                    | "recoverySourceFactorId"
                    | "recoverySourceFactorProof"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "twoFactor";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "secret"
                    | "backupCodes"
                    | "userId"
                    | "verified"
                    | "failedVerificationCount"
                    | "lockedUntil"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "passkey";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "publicKey"
                    | "userId"
                    | "credentialID"
                    | "counter"
                    | "deviceType"
                    | "backedUp"
                    | "transports"
                    | "createdAt"
                    | "aaguid"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthApplication";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "icon"
                    | "metadata"
                    | "clientId"
                    | "clientSecret"
                    | "redirectUrls"
                    | "type"
                    | "disabled"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accessToken"
                    | "refreshToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "consentGiven"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "metadata"
                    | "createdAt"
                    | "experience"
                    | "lifecycle"
                    | "personalOwnerId"
                    | "primaryContactMemberId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "adminEnrolledAt"
                    | "adminFactorId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "inviterId"
                    | "createdAt"
                    | "intendedRole"
                    | "tokenHash"
                    | "acceptedUserId"
                    | "acceptedMemberId"
                    | "deliveryState"
                    | "deliveryVersion"
                    | "deliveredAt"
                    | "deliveryError"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationInvitationClaims";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "invitationId"
                    | "invitationTokenHash"
                    | "capabilityHash"
                    | "expiresAt"
                    | "userId"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationEnrollments";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "memberId"
                    | "purpose"
                    | "name"
                    | "slug"
                    | "passwordProof"
                    | "passwordEmail"
                    | "passwordVerifiedAt"
                    | "backupAcknowledgedAt"
                    | "backupFactorId"
                    | "factorSecretProof"
                    | "backupCodesProof"
                    | "completedAt"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityPolicy";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "passkeyPolicy" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationMigrationBarrier";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "blocked" | "deploymentVersion" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityChanges";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "userId"
                    | "sessionId"
                    | "credentialProof"
                    | "factorId"
                    | "factorSecretProof"
                    | "secret"
                    | "backupCodes"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationAudit";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "actorId"
                    | "action"
                    | "targetId"
                    | "happenedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "rateLimit";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "count" | "lastRequest" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onDeleteHandle?: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
      deleteOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "twoFactorEnabled"
                    | "isAnonymous"
                    | "username"
                    | "displayUsername"
                    | "phoneNumber"
                    | "phoneNumberVerified"
                    | "userId"
                    | "role"
                    | "customerAdmission"
                    | "banned"
                    | "banReason"
                    | "banExpires"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "impersonatedBy"
                    | "activeOrganizationId"
                    | "authPurpose"
                    | "assuranceVersion"
                    | "authMethod"
                    | "authenticatedAt"
                    | "primaryVerifiedAt"
                    | "strongVerifiedAt"
                    | "strongFactorId"
                    | "strongFactorType"
                    | "recoveryOnly"
                    | "recoveryFactorId"
                    | "recoverySourceFactorId"
                    | "recoverySourceFactorProof"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "twoFactor";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "secret"
                    | "backupCodes"
                    | "userId"
                    | "verified"
                    | "failedVerificationCount"
                    | "lockedUntil"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "passkey";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "publicKey"
                    | "userId"
                    | "credentialID"
                    | "counter"
                    | "deviceType"
                    | "backedUp"
                    | "transports"
                    | "createdAt"
                    | "aaguid"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthApplication";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "icon"
                    | "metadata"
                    | "clientId"
                    | "clientSecret"
                    | "redirectUrls"
                    | "type"
                    | "disabled"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accessToken"
                    | "refreshToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "consentGiven"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "metadata"
                    | "createdAt"
                    | "experience"
                    | "lifecycle"
                    | "personalOwnerId"
                    | "primaryContactMemberId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "adminEnrolledAt"
                    | "adminFactorId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "inviterId"
                    | "createdAt"
                    | "intendedRole"
                    | "tokenHash"
                    | "acceptedUserId"
                    | "acceptedMemberId"
                    | "deliveryState"
                    | "deliveryVersion"
                    | "deliveredAt"
                    | "deliveryError"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationInvitationClaims";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "invitationId"
                    | "invitationTokenHash"
                    | "capabilityHash"
                    | "expiresAt"
                    | "userId"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationEnrollments";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "memberId"
                    | "purpose"
                    | "name"
                    | "slug"
                    | "passwordProof"
                    | "passwordEmail"
                    | "passwordVerifiedAt"
                    | "backupAcknowledgedAt"
                    | "backupFactorId"
                    | "factorSecretProof"
                    | "backupCodesProof"
                    | "completedAt"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityPolicy";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "passkeyPolicy" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationMigrationBarrier";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "blocked" | "deploymentVersion" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityChanges";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "userId"
                    | "sessionId"
                    | "credentialProof"
                    | "factorId"
                    | "factorSecretProof"
                    | "secret"
                    | "backupCodes"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationAudit";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "actorId"
                    | "action"
                    | "targetId"
                    | "happenedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "rateLimit";
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "count" | "lastRequest" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onDeleteHandle?: string;
        },
        any,
        Name
      >;
      findMany: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          limit?: number;
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "twoFactor"
            | "passkey"
            | "oauthApplication"
            | "oauthAccessToken"
            | "oauthConsent"
            | "organization"
            | "member"
            | "invitation"
            | "organizationInvitationClaims"
            | "organizationEnrollments"
            | "organizationSecurityPolicy"
            | "organizationMigrationBarrier"
            | "organizationSecurityChanges"
            | "organizationAudit"
            | "jwks"
            | "rateLimit";
          offset?: number;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          select?: Array<string>;
          sortBy?: { direction: "asc" | "desc"; field: string };
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              | string
              | number
              | boolean
              | Array<string>
              | Array<number>
              | null;
          }>;
        },
        any,
        Name
      >;
      findOne: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          model:
            | "user"
            | "session"
            | "account"
            | "verification"
            | "twoFactor"
            | "passkey"
            | "oauthApplication"
            | "oauthAccessToken"
            | "oauthConsent"
            | "organization"
            | "member"
            | "invitation"
            | "organizationInvitationClaims"
            | "organizationEnrollments"
            | "organizationSecurityPolicy"
            | "organizationMigrationBarrier"
            | "organizationSecurityChanges"
            | "organizationAudit"
            | "jwks"
            | "rateLimit";
          select?: Array<string>;
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              | string
              | number
              | boolean
              | Array<string>
              | Array<number>
              | null;
          }>;
        },
        any,
        Name
      >;
      reuseOtp: FunctionReference<
        "mutation",
        "internal",
        {
          allowedAttempts: number;
          expiresAt: number;
          identifier: string;
          value: string;
        },
        any,
        Name
      >;
      updateMany: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                update: {
                  banExpires?: null | number;
                  banReason?: null | string;
                  banned?: null | boolean;
                  createdAt?: number;
                  customerAdmission?: null | string;
                  displayUsername?: null | string;
                  email?: string;
                  emailVerified?: boolean;
                  image?: null | string;
                  isAnonymous?: null | boolean;
                  name?: string;
                  phoneNumber?: null | string;
                  phoneNumberVerified?: null | boolean;
                  role?: null | string;
                  twoFactorEnabled?: null | boolean;
                  updatedAt?: number;
                  userId?: null | string;
                  username?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "twoFactorEnabled"
                    | "isAnonymous"
                    | "username"
                    | "displayUsername"
                    | "phoneNumber"
                    | "phoneNumberVerified"
                    | "userId"
                    | "role"
                    | "customerAdmission"
                    | "banned"
                    | "banReason"
                    | "banExpires"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                update: {
                  activeOrganizationId?: null | string;
                  assuranceVersion?: null | number;
                  authMethod?: null | string;
                  authPurpose?: null | string;
                  authenticatedAt?: null | number;
                  createdAt?: number;
                  expiresAt?: number;
                  impersonatedBy?: null | string;
                  ipAddress?: null | string;
                  primaryVerifiedAt?: null | number;
                  recoveryFactorId?: null | string;
                  recoveryOnly?: null | boolean;
                  recoverySourceFactorId?: null | string;
                  recoverySourceFactorProof?: null | string;
                  strongFactorId?: null | string;
                  strongFactorType?: null | string;
                  strongVerifiedAt?: null | number;
                  token?: string;
                  updatedAt?: number;
                  userAgent?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "impersonatedBy"
                    | "activeOrganizationId"
                    | "authPurpose"
                    | "assuranceVersion"
                    | "authMethod"
                    | "authenticatedAt"
                    | "primaryVerifiedAt"
                    | "strongVerifiedAt"
                    | "strongFactorId"
                    | "strongFactorType"
                    | "recoveryOnly"
                    | "recoveryFactorId"
                    | "recoverySourceFactorId"
                    | "recoverySourceFactorProof"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId?: string;
                  createdAt?: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId?: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                update: {
                  createdAt?: number;
                  expiresAt?: number;
                  identifier?: string;
                  updatedAt?: number;
                  value?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "twoFactor";
                update: {
                  backupCodes?: string;
                  failedVerificationCount?: null | number;
                  lockedUntil?: null | number;
                  secret?: string;
                  userId?: string;
                  verified?: null | boolean;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "secret"
                    | "backupCodes"
                    | "userId"
                    | "verified"
                    | "failedVerificationCount"
                    | "lockedUntil"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "passkey";
                update: {
                  aaguid?: null | string;
                  backedUp?: boolean;
                  counter?: number;
                  createdAt?: null | number;
                  credentialID?: string;
                  deviceType?: string;
                  name?: null | string;
                  publicKey?: string;
                  transports?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "publicKey"
                    | "userId"
                    | "credentialID"
                    | "counter"
                    | "deviceType"
                    | "backedUp"
                    | "transports"
                    | "createdAt"
                    | "aaguid"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthApplication";
                update: {
                  clientId?: null | string;
                  clientSecret?: null | string;
                  createdAt?: null | number;
                  disabled?: null | boolean;
                  icon?: null | string;
                  metadata?: null | string;
                  name?: null | string;
                  redirectUrls?: null | string;
                  type?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "icon"
                    | "metadata"
                    | "clientId"
                    | "clientSecret"
                    | "redirectUrls"
                    | "type"
                    | "disabled"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  clientId?: null | string;
                  createdAt?: null | number;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scopes?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accessToken"
                    | "refreshToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                update: {
                  clientId?: null | string;
                  consentGiven?: null | boolean;
                  createdAt?: null | number;
                  scopes?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "consentGiven"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                update: {
                  createdAt?: number;
                  experience?: null | string;
                  lifecycle?: null | string;
                  logo?: null | string;
                  metadata?: null | string;
                  name?: string;
                  personalOwnerId?: null | string;
                  primaryContactMemberId?: string;
                  slug?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "metadata"
                    | "createdAt"
                    | "experience"
                    | "lifecycle"
                    | "personalOwnerId"
                    | "primaryContactMemberId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                update: {
                  adminEnrolledAt?: null | number;
                  adminFactorId?: null | string;
                  createdAt?: number;
                  organizationId?: string;
                  role?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "adminEnrolledAt"
                    | "adminFactorId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                update: {
                  acceptedMemberId?: string;
                  acceptedUserId?: string;
                  createdAt?: number;
                  deliveredAt?: number;
                  deliveryError?: string;
                  deliveryState?: "pending" | "sent" | "failed";
                  deliveryVersion?: number;
                  email?: string;
                  expiresAt?: number;
                  intendedRole?: null | string;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                  tokenHash?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "inviterId"
                    | "createdAt"
                    | "intendedRole"
                    | "tokenHash"
                    | "acceptedUserId"
                    | "acceptedMemberId"
                    | "deliveryState"
                    | "deliveryVersion"
                    | "deliveredAt"
                    | "deliveryError"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationInvitationClaims";
                update: {
                  capabilityHash?: string;
                  createdAt?: number;
                  expiresAt?: number;
                  invitationId?: string;
                  invitationTokenHash?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "invitationId"
                    | "invitationTokenHash"
                    | "capabilityHash"
                    | "expiresAt"
                    | "userId"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationEnrollments";
                update: {
                  backupAcknowledgedAt?: number;
                  backupCodesProof?: string;
                  backupFactorId?: string;
                  completedAt?: number;
                  createdAt?: number;
                  factorSecretProof?: string;
                  memberId?: string;
                  name?: string;
                  organizationId?: string;
                  passwordEmail?: string;
                  passwordProof?: string;
                  passwordVerifiedAt?: number;
                  purpose?: "collaboration" | "promotion" | "invitation";
                  slug?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "memberId"
                    | "purpose"
                    | "name"
                    | "slug"
                    | "passwordProof"
                    | "passwordEmail"
                    | "passwordVerifiedAt"
                    | "backupAcknowledgedAt"
                    | "backupFactorId"
                    | "factorSecretProof"
                    | "backupCodesProof"
                    | "completedAt"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityPolicy";
                update: {
                  key?: "admin";
                  passkeyPolicy?: "disabled" | "optional" | "required";
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "passkeyPolicy" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationMigrationBarrier";
                update: {
                  blocked?: boolean;
                  deploymentVersion?: string;
                  key?: "organization-v1";
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "blocked" | "deploymentVersion" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityChanges";
                update: {
                  backupCodes?: string;
                  credentialProof?: string;
                  expiresAt?: number;
                  factorId?: string;
                  factorSecretProof?: string;
                  secret?: string;
                  sessionId?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "userId"
                    | "sessionId"
                    | "credentialProof"
                    | "factorId"
                    | "factorSecretProof"
                    | "secret"
                    | "backupCodes"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationAudit";
                update: {
                  action?: string;
                  actorId?: string;
                  happenedAt?: number;
                  organizationId?: string;
                  targetId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "actorId"
                    | "action"
                    | "targetId"
                    | "happenedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                update: {
                  createdAt?: number;
                  expiresAt?: null | number;
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "rateLimit";
                update: {
                  count?: null | number;
                  key?: null | string;
                  lastRequest?: null | number;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "count" | "lastRequest" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onUpdateHandle?: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
      updateOne: FunctionReference<
        "mutation",
        "internal",
        {
          input:
            | {
                model: "user";
                update: {
                  banExpires?: null | number;
                  banReason?: null | string;
                  banned?: null | boolean;
                  createdAt?: number;
                  customerAdmission?: null | string;
                  displayUsername?: null | string;
                  email?: string;
                  emailVerified?: boolean;
                  image?: null | string;
                  isAnonymous?: null | boolean;
                  name?: string;
                  phoneNumber?: null | string;
                  phoneNumberVerified?: null | boolean;
                  role?: null | string;
                  twoFactorEnabled?: null | boolean;
                  updatedAt?: number;
                  userId?: null | string;
                  username?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "email"
                    | "emailVerified"
                    | "image"
                    | "createdAt"
                    | "updatedAt"
                    | "twoFactorEnabled"
                    | "isAnonymous"
                    | "username"
                    | "displayUsername"
                    | "phoneNumber"
                    | "phoneNumberVerified"
                    | "userId"
                    | "role"
                    | "customerAdmission"
                    | "banned"
                    | "banReason"
                    | "banExpires"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "session";
                update: {
                  activeOrganizationId?: null | string;
                  assuranceVersion?: null | number;
                  authMethod?: null | string;
                  authPurpose?: null | string;
                  authenticatedAt?: null | number;
                  createdAt?: number;
                  expiresAt?: number;
                  impersonatedBy?: null | string;
                  ipAddress?: null | string;
                  primaryVerifiedAt?: null | number;
                  recoveryFactorId?: null | string;
                  recoveryOnly?: null | boolean;
                  recoverySourceFactorId?: null | string;
                  recoverySourceFactorProof?: null | string;
                  strongFactorId?: null | string;
                  strongFactorType?: null | string;
                  strongVerifiedAt?: null | number;
                  token?: string;
                  updatedAt?: number;
                  userAgent?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "expiresAt"
                    | "token"
                    | "createdAt"
                    | "updatedAt"
                    | "ipAddress"
                    | "userAgent"
                    | "userId"
                    | "impersonatedBy"
                    | "activeOrganizationId"
                    | "authPurpose"
                    | "assuranceVersion"
                    | "authMethod"
                    | "authenticatedAt"
                    | "primaryVerifiedAt"
                    | "strongVerifiedAt"
                    | "strongFactorId"
                    | "strongFactorType"
                    | "recoveryOnly"
                    | "recoveryFactorId"
                    | "recoverySourceFactorId"
                    | "recoverySourceFactorProof"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "account";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  accountId?: string;
                  createdAt?: number;
                  idToken?: null | string;
                  password?: null | string;
                  providerId?: string;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scope?: null | string;
                  updatedAt?: number;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accountId"
                    | "providerId"
                    | "userId"
                    | "accessToken"
                    | "refreshToken"
                    | "idToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "scope"
                    | "password"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "verification";
                update: {
                  createdAt?: number;
                  expiresAt?: number;
                  identifier?: string;
                  updatedAt?: number;
                  value?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "identifier"
                    | "value"
                    | "expiresAt"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "twoFactor";
                update: {
                  backupCodes?: string;
                  failedVerificationCount?: null | number;
                  lockedUntil?: null | number;
                  secret?: string;
                  userId?: string;
                  verified?: null | boolean;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "secret"
                    | "backupCodes"
                    | "userId"
                    | "verified"
                    | "failedVerificationCount"
                    | "lockedUntil"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "passkey";
                update: {
                  aaguid?: null | string;
                  backedUp?: boolean;
                  counter?: number;
                  createdAt?: null | number;
                  credentialID?: string;
                  deviceType?: string;
                  name?: null | string;
                  publicKey?: string;
                  transports?: null | string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "publicKey"
                    | "userId"
                    | "credentialID"
                    | "counter"
                    | "deviceType"
                    | "backedUp"
                    | "transports"
                    | "createdAt"
                    | "aaguid"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthApplication";
                update: {
                  clientId?: null | string;
                  clientSecret?: null | string;
                  createdAt?: null | number;
                  disabled?: null | boolean;
                  icon?: null | string;
                  metadata?: null | string;
                  name?: null | string;
                  redirectUrls?: null | string;
                  type?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "icon"
                    | "metadata"
                    | "clientId"
                    | "clientSecret"
                    | "redirectUrls"
                    | "type"
                    | "disabled"
                    | "userId"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthAccessToken";
                update: {
                  accessToken?: null | string;
                  accessTokenExpiresAt?: null | number;
                  clientId?: null | string;
                  createdAt?: null | number;
                  refreshToken?: null | string;
                  refreshTokenExpiresAt?: null | number;
                  scopes?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "accessToken"
                    | "refreshToken"
                    | "accessTokenExpiresAt"
                    | "refreshTokenExpiresAt"
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "oauthConsent";
                update: {
                  clientId?: null | string;
                  consentGiven?: null | boolean;
                  createdAt?: null | number;
                  scopes?: null | string;
                  updatedAt?: null | number;
                  userId?: null | string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "clientId"
                    | "userId"
                    | "scopes"
                    | "createdAt"
                    | "updatedAt"
                    | "consentGiven"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organization";
                update: {
                  createdAt?: number;
                  experience?: null | string;
                  lifecycle?: null | string;
                  logo?: null | string;
                  metadata?: null | string;
                  name?: string;
                  personalOwnerId?: null | string;
                  primaryContactMemberId?: string;
                  slug?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "name"
                    | "slug"
                    | "logo"
                    | "metadata"
                    | "createdAt"
                    | "experience"
                    | "lifecycle"
                    | "personalOwnerId"
                    | "primaryContactMemberId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "member";
                update: {
                  adminEnrolledAt?: null | number;
                  adminFactorId?: null | string;
                  createdAt?: number;
                  organizationId?: string;
                  role?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "role"
                    | "createdAt"
                    | "adminEnrolledAt"
                    | "adminFactorId"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "invitation";
                update: {
                  acceptedMemberId?: string;
                  acceptedUserId?: string;
                  createdAt?: number;
                  deliveredAt?: number;
                  deliveryError?: string;
                  deliveryState?: "pending" | "sent" | "failed";
                  deliveryVersion?: number;
                  email?: string;
                  expiresAt?: number;
                  intendedRole?: null | string;
                  inviterId?: string;
                  organizationId?: string;
                  role?: null | string;
                  status?: string;
                  tokenHash?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "email"
                    | "role"
                    | "status"
                    | "expiresAt"
                    | "inviterId"
                    | "createdAt"
                    | "intendedRole"
                    | "tokenHash"
                    | "acceptedUserId"
                    | "acceptedMemberId"
                    | "deliveryState"
                    | "deliveryVersion"
                    | "deliveredAt"
                    | "deliveryError"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationInvitationClaims";
                update: {
                  capabilityHash?: string;
                  createdAt?: number;
                  expiresAt?: number;
                  invitationId?: string;
                  invitationTokenHash?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "invitationId"
                    | "invitationTokenHash"
                    | "capabilityHash"
                    | "expiresAt"
                    | "userId"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationEnrollments";
                update: {
                  backupAcknowledgedAt?: number;
                  backupCodesProof?: string;
                  backupFactorId?: string;
                  completedAt?: number;
                  createdAt?: number;
                  factorSecretProof?: string;
                  memberId?: string;
                  name?: string;
                  organizationId?: string;
                  passwordEmail?: string;
                  passwordProof?: string;
                  passwordVerifiedAt?: number;
                  purpose?: "collaboration" | "promotion" | "invitation";
                  slug?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "userId"
                    | "memberId"
                    | "purpose"
                    | "name"
                    | "slug"
                    | "passwordProof"
                    | "passwordEmail"
                    | "passwordVerifiedAt"
                    | "backupAcknowledgedAt"
                    | "backupFactorId"
                    | "factorSecretProof"
                    | "backupCodesProof"
                    | "completedAt"
                    | "createdAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityPolicy";
                update: {
                  key?: "admin";
                  passkeyPolicy?: "disabled" | "optional" | "required";
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "passkeyPolicy" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationMigrationBarrier";
                update: {
                  blocked?: boolean;
                  deploymentVersion?: string;
                  key?: "organization-v1";
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "blocked" | "deploymentVersion" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationSecurityChanges";
                update: {
                  backupCodes?: string;
                  credentialProof?: string;
                  expiresAt?: number;
                  factorId?: string;
                  factorSecretProof?: string;
                  secret?: string;
                  sessionId?: string;
                  userId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "userId"
                    | "sessionId"
                    | "credentialProof"
                    | "factorId"
                    | "factorSecretProof"
                    | "secret"
                    | "backupCodes"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "organizationAudit";
                update: {
                  action?: string;
                  actorId?: string;
                  happenedAt?: number;
                  organizationId?: string;
                  targetId?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "organizationId"
                    | "actorId"
                    | "action"
                    | "targetId"
                    | "happenedAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "jwks";
                update: {
                  createdAt?: number;
                  expiresAt?: null | number;
                  privateKey?: string;
                  publicKey?: string;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field:
                    | "publicKey"
                    | "privateKey"
                    | "createdAt"
                    | "expiresAt"
                    | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              }
            | {
                model: "rateLimit";
                update: {
                  count?: null | number;
                  key?: null | string;
                  lastRequest?: null | number;
                };
                where?: Array<{
                  connector?: "AND" | "OR";
                  field: "key" | "count" | "lastRequest" | "_id";
                  mode?: "sensitive" | "insensitive";
                  operator?:
                    | "lt"
                    | "lte"
                    | "gt"
                    | "gte"
                    | "eq"
                    | "in"
                    | "not_in"
                    | "ne"
                    | "contains"
                    | "starts_with"
                    | "ends_with";
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null;
                }>;
              };
          onUpdateHandle?: string;
        },
        any,
        Name
      >;
    };
    memberInvitations: {
      accept: FunctionReference<
        "mutation",
        "internal",
        { organizationId: string; tokenHash: string; userId: string },
        any,
        Name
      >;
      cancel: FunctionReference<
        "mutation",
        "internal",
        { actorId: string; invitationId: string; organizationId: string },
        any,
        Name
      >;
      delivery: FunctionReference<
        "query",
        "internal",
        {
          invitationId: string;
          organizationId: string;
          tokenHash: string;
          version: number;
        },
        any,
        Name
      >;
      exchange: FunctionReference<
        "mutation",
        "internal",
        { capabilityHash: string; organizationId: string; tokenHash: string },
        any,
        Name
      >;
      issue: FunctionReference<
        "mutation",
        "internal",
        {
          actorId: string;
          email: string;
          expiresAt: number;
          organizationId: string;
          role: "member" | "org-admin";
          tokenHash: string;
        },
        any,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          actorId: string;
          organizationId: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
      preview: FunctionReference<
        "query",
        "internal",
        { organizationId: string; tokenHash: string },
        any,
        Name
      >;
      recordDelivery: FunctionReference<
        "mutation",
        "internal",
        {
          invitationId: string;
          organizationId: string;
          sent: boolean;
          tokenHash: string;
          version: number;
        },
        any,
        Name
      >;
      register: FunctionReference<
        "mutation",
        "internal",
        {
          capabilityHash: string;
          email: string;
          name: string;
          passwordHash: string;
        },
        any,
        Name
      >;
      registration: FunctionReference<
        "query",
        "internal",
        { capabilityHash: string; email: string },
        any,
        Name
      >;
      resend: FunctionReference<
        "mutation",
        "internal",
        {
          actorId: string;
          invitationId: string;
          organizationId: string;
          tokenHash: string;
        },
        any,
        Name
      >;
      verificationRecipient: FunctionReference<
        "query",
        "internal",
        { organizationId: string; tokenHash: string; userId: string },
        any,
        Name
      >;
    };
    organizationAudit: {
      list: FunctionReference<
        "query",
        "internal",
        { actorId: string; organizationId: string },
        any,
        Name
      >;
    };
    organizationMigration: {
      provisionLegacyPersonal: FunctionReference<
        "mutation",
        "internal",
        { deploymentVersion: string; userId: string },
        any,
        Name
      >;
    };
    organizationMigrationBarrier: {
      set: FunctionReference<
        "mutation",
        "internal",
        { blocked: boolean; deploymentVersion: string },
        any,
        Name
      >;
    };
    organizations: {
      acknowledgeRecovery: FunctionReference<
        "mutation",
        "internal",
        {
          backupCodesProof: string;
          factorId: string;
          organizationId: string;
          userId: string;
        },
        any,
        Name
      >;
      adminSecurity: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any,
        Name
      >;
      beginCollaboration: FunctionReference<
        "mutation",
        "internal",
        { name: string; organizationId: string; slug: string; userId: string },
        any,
        Name
      >;
      beginMembershipManagement: FunctionReference<
        "mutation",
        "internal",
        { name: string; organizationId: string; slug: string; userId: string },
        any,
        Name
      >;
      changeMember: FunctionReference<
        "mutation",
        "internal",
        {
          actorId: string;
          memberId: string;
          operation: "remove" | "demote" | "promote";
          organizationId: string;
        },
        any,
        Name
      >;
      completeEnrollment: FunctionReference<
        "mutation",
        "internal",
        { organizationId: string; requirePasskey: boolean; userId: string },
        any,
        Name
      >;
      contacts: FunctionReference<
        "query",
        "internal",
        { operatorId: string; organizationId: string },
        any,
        Name
      >;
      context: FunctionReference<
        "query",
        "internal",
        { organizationId: string; userId: string },
        any,
        Name
      >;
      controlList: FunctionReference<
        "query",
        "internal",
        {
          operatorId: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
      directory: FunctionReference<
        "query",
        "internal",
        {
          actorId: string;
          organizationId: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
      enrollmentStatus: FunctionReference<
        "query",
        "internal",
        { organizationId: string; userId: string },
        any,
        Name
      >;
      leave: FunctionReference<
        "mutation",
        "internal",
        { organizationId: string; userId: string },
        any,
        Name
      >;
      legacyPrivateAccess: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any,
        Name
      >;
      mine: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any,
        Name
      >;
      provisionPersonal: FunctionReference<
        "mutation",
        "internal",
        { userId: string },
        any,
        Name
      >;
      recordPasswordProof: FunctionReference<
        "mutation",
        "internal",
        { credentialProof: string; organizationId: string; userId: string },
        any,
        Name
      >;
      resumeCustomerProvisioning: FunctionReference<
        "mutation",
        "internal",
        { userId: string },
        any,
        Name
      >;
      setContact: FunctionReference<
        "mutation",
        "internal",
        { actorId: string; memberId: string; organizationId: string },
        any,
        Name
      >;
      setLifecycle: FunctionReference<
        "mutation",
        "internal",
        {
          lifecycle: "active" | "disabled";
          operatorId: string;
          organizationId: string;
        },
        any,
        Name
      >;
    };
    organizationSecurity: {
      consumeRecoveryCode: FunctionReference<
        "mutation",
        "internal",
        {
          currentCodes: string;
          factorId: string;
          nextCodes: string;
          userId: string;
        },
        any,
        Name
      >;
      hasEnrollment: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any,
        Name
      >;
      initializeMigrationPolicy: FunctionReference<
        "mutation",
        "internal",
        {
          deploymentVersion: string;
          value: "disabled" | "optional" | "required";
        },
        any,
        Name
      >;
      initializePolicy: FunctionReference<
        "mutation",
        "internal",
        { value: "disabled" | "optional" | "required" },
        any,
        Name
      >;
      policy: FunctionReference<"query", "internal", {}, any, Name>;
      replaceCredential: FunctionReference<
        "mutation",
        "internal",
        {
          adminPasswordValidated: boolean;
          currentHash: string;
          newHash: string;
          sessionId?: string;
          userId: string;
        },
        any,
        Name
      >;
      replaceFactor: FunctionReference<
        "mutation",
        "internal",
        {
          changeId: string;
          replacementProof: string;
          sessionId: string;
          userId: string;
        },
        any,
        Name
      >;
      setPolicy: FunctionReference<
        "mutation",
        "internal",
        { key: string; value: string },
        any,
        Name
      >;
      snapshot: FunctionReference<
        "query",
        "internal",
        { sessionId: string; userId: string },
        any,
        Name
      >;
      stagedFactor: FunctionReference<
        "query",
        "internal",
        { changeId: string; sessionId: string; userId: string },
        any,
        Name
      >;
      stageFactor: FunctionReference<
        "mutation",
        "internal",
        {
          backupCodes: string;
          credentialProof: string;
          factorSecretProof: string;
          secret: string;
          sessionId: string;
          userId: string;
        },
        any,
        Name
      >;
      verifyMigrationPolicyPage: FunctionReference<
        "query",
        "internal",
        {
          deploymentVersion: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        any,
        Name
      >;
    };
  };
