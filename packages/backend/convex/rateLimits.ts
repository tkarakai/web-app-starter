import { defineRateLimits } from "convex-helpers/server/rateLimit";

const MINUTE = 60_000;

/** Parse an env var as a positive integer, falling back to a safe default. */
function positiveInt(envVar: string | undefined, defaultValue: number): number {
  const parsed = parseInt(envVar ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

/**
 * Centralized rate limit definitions for Convex functions.
 *
 * Token bucket: smooth rate over time, allows burst up to capacity.
 * All values are configurable via Convex environment variables.
 */
export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  /** Global per-user mutation rate limit applied to all authedMutation calls. */
  mutationGlobal: {
    kind: "token bucket",
    rate: positiveInt(process.env.MUTATION_RATE_LIMIT_RATE, 30),
    period: positiveInt(process.env.MUTATION_RATE_LIMIT_PERIOD, MINUTE),
    capacity: positiveInt(process.env.MUTATION_RATE_LIMIT_CAPACITY, 10),
  },
});
