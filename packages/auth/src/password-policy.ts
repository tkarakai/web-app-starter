/** Shared policy for the server, input constraints and strength feedback. */
export type PasswordRole = "admin" | "user";

export const REQUIRED_PASSWORD_SCORE = 4;

export function getMinPasswordLength(role: PasswordRole): number {
  return role === "admin" ? 40 : 12;
}
