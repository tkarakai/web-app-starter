/** Durable, server-owned intent. Legacy/member/operator accounts have no implicit customer admission. */
export const customerAdmissionFields = {
  customerAdmission: { type: "string", required: false, input: false, returned: false },
} as const;
