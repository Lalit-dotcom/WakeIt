/**
 * Framework-free core: warm-state cache, back-off maths and a one-shot
 * `prewarm()` call that works outside React.
 */

const CACHE_PREFIX = "wakeit:warm:";

/** Platforms answer with these while the container is still booting. */
export const BOOTING_STATUSES = [502, 503, 504];

/** localStorage key that stores the warm timestamp for one endpoint. */
export function getWakeItCacheKey(endpoint: string): string {
  return CACHE_PREFIX + endpoint;
}

export function isCacheValid(endpoint: string, cacheTtlMs: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(getWakeItCacheKey(endpoint));
    if (!stored) return false;
    const timestamp = parseInt(stored, 10);
    if (isNaN(timestamp)) return false;
    return Date.now() - timestamp < cacheTtlMs;
  } catch {
    return false;
  }
}

export function setCacheValid(endpoint: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getWakeItCacheKey(endpoint), Date.now().toString());
  } catch {
    // Storage can be blocked (private mode, quota). The cache is optional.
  }
}

export function clearCache(endpoint: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getWakeItCacheKey(endpoint));
  } catch {
    // ignore
  }
}

/**
 * Delay before retry number `attempt` (1 = first retry).
 *
 * 'fixed' returns `baseMs`. 'exponential' doubles the delay each attempt, caps
 * it at `maxMs`, then picks a random value in the upper half of that range
 * ("equal jitter"), so many clients do not retry at the same instant and the
 * delay never collapses to zero.
 */
export function computeRetryDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  mode: "exponential" | "fixed",
  random: () => number = Math.random,
): number {
  if (mode === "fixed") return baseMs;
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.round(exp / 2 + random() * (exp / 2));
}

export type PrewarmResult = {
  /** True when the endpoint answered with a 2xx status. */
  ok: boolean;
  /** HTTP status code, or null when the request failed or timed out. */
  status: number | null;
  /** Duration of the request in ms. */
  elapsedMs: number;
};

export type PrewarmOptions = {
  /** Abort the request after this many ms (default: 65000). */
  timeoutMs?: number;
};

const inFlight = new Map<string, Promise<PrewarmResult>>();

/**
 * Sends one request to the health endpoint so the platform starts booting the
 * backend. Call it as early as possible, for example on a landing page or when
 * the user hovers a "Log in" link. Works without React.
 *
 * Calls for the same endpoint that overlap share one request. A successful
 * reply is stored in the warm cache that `WakeItProvider` reads.
 */
export function prewarm(
  endpoint: string,
  options: PrewarmOptions = {},
): Promise<PrewarmResult> {
  const existing = inFlight.get(endpoint);
  if (existing) return existing;

  const timeoutMs = options.timeoutMs ?? 65000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  const request: Promise<PrewarmResult> = fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: controller.signal,
  })
    .then((response) => {
      if (response.ok) setCacheValid(endpoint);
      return {
        ok: response.ok,
        status: response.status,
        elapsedMs: Math.round(performance.now() - start),
      };
    })
    .catch(() => ({
      ok: false,
      status: null,
      elapsedMs: Math.round(performance.now() - start),
    }))
    .finally(() => {
      clearTimeout(timer);
      inFlight.delete(endpoint);
    });

  inFlight.set(endpoint, request);
  return request;
}
