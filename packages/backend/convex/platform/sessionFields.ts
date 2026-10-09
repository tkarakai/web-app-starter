/** Only trusted authentication hooks may write proof. Never accept it from a client. */
export const sessionFields = {
  authPurpose: { type: "string", required: false, input: false, returned: false },
  assuranceVersion: { type: "number", required: false, input: false, returned: false },
  authMethod: { type: "string", required: false, input: false, returned: false },
  authenticatedAt: { type: "number", required: false, input: false, returned: false },
  primaryVerifiedAt: { type: "number", required: false, input: false, returned: false },
  strongVerifiedAt: { type: "number", required: false, input: false, returned: false },
  strongFactorId: { type: "string", required: false, input: false, returned: false },
  strongFactorType: { type: "string", required: false, input: false, returned: false },
  recoveryOnly: { type: "boolean", required: false, input: false, returned: false },
  recoveryFactorId: { type: "string", required: false, input: false, returned: false },
  recoverySourceFactorId: { type: "string", required: false, input: false, returned: false },
  recoverySourceFactorProof: { type: "string", required: false, input: false, returned: false },
} as const;

export const ADMIN_SESSION_MS = 4 * 60 * 60 * 1000;
export const RECENT_AUTH_MS = 5 * 60 * 1000;
