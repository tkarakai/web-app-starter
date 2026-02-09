import { defineRateLimits } from "convex-helpers/server/rateLimit";

const MINUTE = 60_000;

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
    rate: Number(process.env.MUTATION_RATE_LIMIT_RATE ?? "30"),
    period: Number(process.env.MUTATION_RATE_LIMIT_PERIOD ?? String(MINUTE)),
    capacity: Number(process.env.MUTATION_RATE_LIMIT_CAPACITY ?? "10"),
  },
});
