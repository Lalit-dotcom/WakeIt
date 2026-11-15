export type WakeItBannerPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "bottom-center"
  | "top-center";

/** Hosting platform presets. They only change the warm-cache lifetime. */
export type WakeItPlatform =
  | "render"
  | "railway"
  | "fly"
  | "koyeb"
  | "heroku"
  | "custom";

/** Lifecycle events emitted through `config.onEvent` (used for measurement). */
export type WakeItEventType =
  | "probe_start"
  | "first_byte"
  | "status_change"
  | "retry_scheduled"
  | "ready"
  | "error";

export type WakeItEvent = {
  type: WakeItEventType;
  /** Milliseconds from `performance.now()` (monotonic, relative to page load). */
  t: number;
  /** Wall-clock time in ms since the Unix epoch. */
  wallTime: number;
  endpoint: string;
  /** New status, for `status_change`. */
  status?: string;
  /** HTTP status code of the probe response, when there was one. */
  httpStatus?: number;
  /** Duration of the probe request in ms (`first_byte`, `ready`, `error`). */
  elapsedMs?: number;
  /** Retry number (`retry_scheduled`). */
  attempt?: number;
  /** Delay before the next retry in ms (`retry_scheduled`). */
  delayMs?: number;
  /** True when the probe only re-checks a cached "warm" state. */
  background?: boolean;
};

export type WakeItConfig = {
  /** Health check API endpoint (default: '/api/health') */
  healthEndpoint?: string;
  /**
   * Hosting platform of the backend. Sets a warm-cache lifetime that is shorter
   * than the platform's documented idle timeout. An explicit `cacheTtlMs` wins.
   * (default: 'custom')
   */
  platform?: WakeItPlatform;
  /** Screen position for the floating UI banner (default: 'bottom-right') */
  position?: WakeItBannerPosition;
  /** Whether to display the visual banner while waking up (default: true) */
  showBannerOnWarmup?: boolean;
  /** Whether to show the green success badge when the server wakes up (default: true) */
  showSuccessToast?: boolean;
  /** Whether to show the red alert banner if the health check fails (default: false) */
  showBannerOnError?: boolean;
  /** Max auto-retries on probe failure. Number or 'endless' (default: 3) */
  maxRetries?: number | "endless";
  /**
   * Base delay in ms between retry attempts (default: 2000).
   * With `retryBackoff: 'fixed'` this is the exact delay.
   */
  retryIntervalMs?: number;
  /**
   * 'exponential' doubles the delay after every failed attempt, up to
   * `retryMaxIntervalMs`, and adds random jitter. 'fixed' always waits
   * `retryIntervalMs`. (default: 'exponential')
   */
  retryBackoff?: "exponential" | "fixed";
  /** Upper limit in ms for one back-off delay (default: 15000) */
  retryMaxIntervalMs?: number;
  /**
   * How long (ms) to keep retrying while the server answers 502/503/504, i.e. the
   * platform is still booting the container. These retries do NOT count against
   * maxRetries. (default: 90000)
   */
  bootWindowMs?: number;
  /** Delay in ms before showing the banner. Faster replies stay silent. (default: 1500) */
  showBannerDelayMs?: number;
  /** Timeout in ms before aborting one health check request (default: 65000) */
  timeoutMs?: number;
  /** Duration in ms for the success badge to auto-hide (default: 4000, 0 disables) */
  autoHideMs?: number;
  /**
   * How long (ms) a successful probe is remembered in localStorage.
   * Default: taken from `platform` (14 minutes for 'custom').
   */
  cacheTtlMs?: number;
  /**
   * When a cached "warm" state is found, still send one probe in the background
   * to confirm it. The UI starts as `ready`; if the probe is slow the state drops
   * back to `warming`. Set false to trust the cache without any request, as
   * v1.0 did. (default: true)
   */
  verifyCachedState?: boolean;
  /** Print diagnostic messages to the console (default: false) */
  debug?: boolean;
  /** Receives timestamped lifecycle events. Useful for measurement. */
  onEvent?: (event: WakeItEvent) => void;
  /** Customizable UI text labels */
  messages?: {
    warming?: string;
    warmingSubtext?: string;
    ready?: string;
    error?: string;
    errorSubtext?: string;
    retryButtonText?: string;
    dismissButtonLabel?: string;
  };
};

/**
 * Warm-cache lifetimes per platform. Each value is deliberately shorter than the
 * idle period after which the platform stops an inactive service, so a cached
 * "warm" flag should expire before the server can have gone to sleep.
 *
 * Idle periods as documented by each provider (checked November 2026):
 * - Render free web service: spun down after 15 minutes without inbound traffic.
 *   https://render.com/docs/free
 * - Railway (Serverless): inactive after about 5 minutes without outbound traffic.
 *   https://docs.railway.com/deployments/serverless
 * - Fly.io (auto_stop_machines): the proxy's stop loop runs every few minutes;
 *   no exact figure is documented, so the cache is kept very short.
 *   https://fly.io/docs/launch/autostop-autostart/
 * - Koyeb free instance: scales to zero after 1 hour without traffic.
 *   https://www.koyeb.com/docs/run-and-scale/scale-to-zero
 * - Heroku Eco dyno: sleeps after 30 minutes without web traffic.
 *   https://devcenter.heroku.com/articles/eco-dyno-hours
 *
 * Providers change these values. With `verifyCachedState` (on by default) a wrong
 * value costs one extra request, not a wrong "ready" state.
 */
export const WAKEIT_PLATFORM_CACHE_TTL_MS: Record<WakeItPlatform, number> = {
  render: 14 * 60 * 1000,
  railway: 4 * 60 * 1000,
  fly: 2 * 60 * 1000,
  koyeb: 55 * 60 * 1000,
  heroku: 28 * 60 * 1000,
  custom: 14 * 60 * 1000,
};

/** Returns the cache lifetime in ms that applies to a config. */
export function resolveCacheTtlMs(config: WakeItConfig): number {
  if (typeof config.cacheTtlMs === "number") return config.cacheTtlMs;
  return WAKEIT_PLATFORM_CACHE_TTL_MS[config.platform ?? "custom"];
}

/**
 * Default configuration. Override any field through the `config` prop of
 * `WakeItProvider`.
 */
export const defaultWakeItConfig: WakeItConfig = {
  healthEndpoint: "/api/health",
  platform: "custom",
  position: "bottom-right",
  showBannerOnWarmup: true,
  showSuccessToast: true,
  showBannerOnError: false,
  maxRetries: 3,
  retryIntervalMs: 2000,
  retryBackoff: "exponential",
  retryMaxIntervalMs: 15000,
  bootWindowMs: 90000,
  showBannerDelayMs: 1500,
  timeoutMs: 65000,
  autoHideMs: 4000,
  verifyCachedState: true,
  debug: false,
  messages: {
    warming: "Waking up server...",
    warmingSubtext:
      "The server is starting. This can take up to a minute on free hosting.",
    ready: "Server Warm & Ready!",
    error: "Server connection delayed",
    errorSubtext: "Click retry to contact the server again.",
    retryButtonText: "Retry",
    dismissButtonLabel: "Dismiss server status",
  },
};
