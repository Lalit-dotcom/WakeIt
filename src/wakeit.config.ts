export type WakeItBannerPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "bottom-center"
  | "top-center";

export type WakeItConfig = {
  /** Health check API endpoint (default: '/api/health') */
  healthEndpoint?: string;
  /** Screen position for the floating UI banner (default: 'bottom-right') */
  position?: WakeItBannerPosition;
  /** Whether to display the visual banner while waking up (default: true) */
  showBannerOnWarmup?: boolean;
  /** Whether to show green success badge when server wakes up (default: true) */
  showSuccessToast?: boolean;
  /** Whether to show red alert banner if health check fails (default: false to keep UX clean!) */
  showBannerOnError?: boolean;
  /** Max auto-retries on ping failure. Number or 'endless' for continuous background retries (default: 3) */
  maxRetries?: number | "endless";
  /** Delay in milliseconds between retry attempts (default: 5000ms) */
  retryIntervalMs?: number;
  /** Delay in ms before showing banner. If server responds faster, stays silent! (default: 1500ms) */
  showBannerDelayMs?: number;
  /** Timeout in ms before aborting health check request (default: 65000ms for Render) */
  timeoutMs?: number;
  /** Duration in ms for success badge to auto-hide (default: 4000ms, set 0 to disable auto-hide) */
  autoHideMs?: number;
  /** Local storage cache duration in ms (default: 14 minutes = 840,000ms) */
  cacheTtlMs?: number;
  /** Customizable UI text labels */
  messages?: {
    warming?: string;
    warmingSubtext?: string;
    ready?: string;
    error?: string;
    errorSubtext?: string;
    retryButtonText?: string;
  };
};

/**
 * ⚡ Default Configuration for wakeIt Tool.
 * Edit values here to customize defaults for your whole app, or override per-provider props!
 */
export const defaultWakeItConfig: WakeItConfig = {
  healthEndpoint: "/api/health",
  position: "bottom-right",
  showBannerOnWarmup: true,
  showSuccessToast: true,
  showBannerOnError: false, // Set true if you want red error popups, false to keep UX clean!
  maxRetries: 3, // Set a number like 5, or 'endless' for continuous auto-retries!
  retryIntervalMs: 5000,
  showBannerDelayMs: 1500,
  timeoutMs: 65000,
  autoHideMs: 4000,
  cacheTtlMs: 14 * 60 * 1000, // 14 minutes cache
  messages: {
    warming: "Waking up server...",
    warmingSubtext: "Render cold-start in progress (~30-50s). UI is ready!",
    ready: "Server Warm & Ready!",
    error: "Server connection delayed",
    errorSubtext: "Click retry to ping backend.",
    retryButtonText: "Retry",
  },
};
