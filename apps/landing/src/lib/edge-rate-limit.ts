/**
 * In-memory fixed window rate limiter for Edge Runtime.
 *
 * Limitations:
 * - Per-instance only (each serverless instance has its own counter)
 * - Not persistent across deployments
 * - First line of defense — primary rate limiting is handled by
 *   Better Auth (Layer 1) and Convex function rate limits (Layer 2)
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60_000;

function cleanup(now: number, maxSize: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL && store.size < maxSize) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) {
      store.delete(key);
    }
  }
}

export interface EdgeRateLimitConfig {
  /** Time window in seconds. */
  windowSeconds: number;
  /** Maximum requests per window. */
  maxRequests: number;
  /** Maximum number of tracked IPs. When exceeded, new IPs are blocked (fail-closed). */
  maxMapSize: number;
}

export interface EdgeRateLimitResult {
  allowed: boolean;
  /** Remaining requests in current window. */
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
}

export function checkEdgeRateLimit(
  ip: string,
  config: EdgeRateLimitConfig,
): EdgeRateLimitResult {
  const now = Date.now();
  cleanup(now, config.maxMapSize);

  const entry = store.get(ip);

  if (!entry || now >= entry.resetAt) {
    // Fail-closed: if the map is at capacity with no room for a new IP, block.
    if (!entry && store.size >= config.maxMapSize) {
      return { allowed: false, remaining: 0, resetAt: now + config.windowSeconds * 1000 };
    }

    const resetAt = now + config.windowSeconds * 1000;
    store.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  entry.count += 1;

  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/** Reset all entries. Exposed for testing. */
export function _resetStore(): void {
  store.clear();
}
