/**
 * Progressive delay on repeated login failures (§6.7, criterion #8).
 * There is deliberately NO permanent lockout: after 5 failures the response is
 * delayed with exponential backoff, and the delay decays with the failure window.
 */

const WINDOW_MS = 15 * 60 * 1000;
const THRESHOLD = 5;

interface Bucket {
  failures: number[];
}

const buckets = new Map<string, Bucket>();

export const THROTTLE = {
  threshold: THRESHOLD,
  windowMs: WINDOW_MS,
  baseDelayMs: Number(process.env.THROTTLE_BASE_DELAY_MS ?? 500),
  maxDelayMs: Number(process.env.THROTTLE_MAX_DELAY_MS ?? 30_000),
  challengeAfter: Number(process.env.THROTTLE_CHALLENGE_AFTER ?? 3),
};

function prune(bucket: Bucket, now: number) {
  bucket.failures = bucket.failures.filter((t) => now - t < WINDOW_MS);
}

function get(key: string, now: number): Bucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { failures: [] };
    buckets.set(key, bucket);
  }
  prune(bucket, now);
  return bucket;
}

export function failureCount(key: string, now = Date.now()): number {
  return get(key, now).failures.length;
}

export function recordFailure(key: string, now = Date.now()) {
  const bucket = get(key, now);
  bucket.failures.push(now);
  if (bucket.failures.length > 200) bucket.failures = bucket.failures.slice(-200);
}

export function clearFailures(key: string) {
  buckets.delete(key);
}

export function delayFor(key: string, now = Date.now()): number {
  const { failures } = get(key, now);
  const n = failures.length;
  if (n < THRESHOLD) return 0;
  const exponent = Math.min(20, n - THRESHOLD);
  return Math.min(THROTTLE.maxDelayMs, THROTTLE.baseDelayMs * 2 ** exponent);
}

export function requiresChallenge(key: string, now = Date.now()): boolean {
  return get(key, now).failures.length >= THROTTLE.challengeAfter;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Small constant floor so success and failure paths cost a comparable amount of time. */
export async function applyLoginDelay(keys: string[], extraFloorMs = 120) {
  const now = Date.now();
  const delay = Math.max(extraFloorMs, ...keys.map((k) => delayFor(k, now)));
  if (delay > 0) await sleep(delay);
}

export function resetThrottleState() {
  buckets.clear();
}

/** Generic in-memory limiter for non-login endpoints (support, servers, API). */
const generic = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const hits = (generic.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    generic.set(key, hits);
    return false;
  }
  hits.push(now);
  generic.set(key, hits);
  if (generic.size > 10_000) generic.clear();
  return true;
}

export function resetGenericLimits() {
  generic.clear();
}
