/** Maximum lengths for user-supplied string fields (defense against resource exhaustion). */
export const MAX_NAME_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 5000;

/** Throw if a string exceeds the allowed length. */
export function assertMaxLength(
  value: string | undefined,
  maxLength: number,
  fieldName: string,
): void {
  if (value !== undefined && value.length > maxLength) {
    throw new Error(`${fieldName}_TOO_LONG`);
  }
}
