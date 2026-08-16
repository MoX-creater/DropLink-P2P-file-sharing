/**
 * In-memory sliding-window rate limiter for join-room attempts per IP.
 *
 * Counts every join-room message (successful, rejected, or malformed) against
 * the originating IP. A sliding window is approximated by storing a list of
 * timestamps and pruning those older than the window on each check.
 *
 * Configuration (env vars, all optional):
 *   RATE_LIMIT_MAX_ATTEMPTS  — max attempts per window  (default: 10)
 *   RATE_LIMIT_WINDOW_MS     — window size in ms        (default: 60000 / 1 min)
 */

const MAX_ATTEMPTS =
  parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS, 10) || 10;
const WINDOW_MS =
  parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;

/** @type {Map<string, number[]>}  ip → sorted array of attempt timestamps */
const attempts = new Map();

/**
 * Record a join attempt from the given IP and return whether it is allowed.
 *
 * @param {string} ip
 * @returns {boolean}  true = allowed, false = rate-limited
 */
export function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Retrieve and prune stale timestamps.
  const timestamps = (attempts.get(ip) ?? []).filter(
    (t) => t > windowStart,
  );

  if (timestamps.length >= MAX_ATTEMPTS) {
    // Still store the updated (pruned) list without adding this attempt — the
    // caller is already over the limit, no need to grow the array further.
    attempts.set(ip, timestamps);
    return false;
  }

  timestamps.push(now);
  attempts.set(ip, timestamps);
  return true;
}

/**
 * Remove the entry for an IP entirely (useful for testing / cleanup).
 *
 * @param {string} ip
 */
export function resetRateLimit(ip) {
  attempts.delete(ip);
}

/**
 * Periodically purge IPs whose entire window has expired to avoid unbounded
 * memory growth.  Call once at startup.
 *
 * @param {number} [intervalMs]  How often to run the sweep (default: WINDOW_MS).
 * @returns {NodeJS.Timeout}
 */
export function startRateLimitSweep(intervalMs = WINDOW_MS) {
  return setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [ip, timestamps] of attempts) {
      const fresh = timestamps.filter((t) => t > cutoff);
      if (fresh.length === 0) {
        attempts.delete(ip);
      } else {
        attempts.set(ip, fresh);
      }
    }
  }, intervalMs);
}
