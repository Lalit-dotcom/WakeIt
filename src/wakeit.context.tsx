import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defaultWakeItConfig, type WakeItConfig } from "./wakeit.config";

export type WakeItStatus = "idle" | "checking" | "warming" | "ready" | "error";

export type WakeItState = {
  status: WakeItStatus;
  isReady: boolean;
  isWarming: boolean;
  responseTimeMs: number | null;
  retryCount: number;
  bannerVisible: boolean;
  config: WakeItConfig;
  checkBackend: (force?: boolean) => Promise<boolean>;
  dismissBanner: () => void;
};

export type WakeItProviderProps = {
  children: ReactNode;
  /** Partial or full WakeItConfig override. Falls back to defaultWakeItConfig in wakeit.config.ts */
  config?: WakeItConfig;
  /** Shorthand for health check endpoint URL */
  healthEndpoint?: string;
};

const WakeItContext = createContext<WakeItState | null>(null);

const STORAGE_CACHE_KEY = "wakeit_backend_warmup_ts";

/** Platforms answer with these while the container is still booting. */
const BOOTING_STATUSES = [502, 503, 504];

class HttpStatusError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP status ${status}`);
    this.status = status;
  }
}

function isCacheValid(cacheTtlMs: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(STORAGE_CACHE_KEY);
    if (!stored) return false;
    const timestamp = parseInt(stored, 10);
    if (isNaN(timestamp)) return false;
    return Date.now() - timestamp < cacheTtlMs;
  } catch {
    return false;
  }
}

function setCacheValid(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, Date.now().toString());
  } catch {
    // Ignore storage errors
  }
}

export function WakeItProvider({
  children,
  config: customConfig,
  healthEndpoint,
}: WakeItProviderProps) {
  const mergedConfig: WakeItConfig = {
    ...defaultWakeItConfig,
    ...customConfig,
    messages: {
      ...defaultWakeItConfig.messages,
      ...customConfig?.messages,
    },
  };

  if (healthEndpoint) {
    mergedConfig.healthEndpoint = healthEndpoint;
  }

  const configRef = useRef<WakeItConfig>(mergedConfig);
  useEffect(() => {
    configRef.current = mergedConfig;
  });

  const cacheTtlMs = mergedConfig.cacheTtlMs ?? 14 * 60 * 1000;

  const [status, setStatus] = useState<WakeItStatus>(() =>
    isCacheValid(cacheTtlMs) ? "ready" : "idle",
  );
  const [responseTimeMs, setResponseTimeMs] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [bannerVisible, setBannerVisible] = useState(false);

  const activeCheckRef = useRef<boolean>(false);
  const currentRetryRef = useRef<number>(0);
  const retryTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryRef = useRef<boolean>(false); // true only when the retry timer calls runCheck
  const bootStartRef = useRef<number | null>(null); // when we first saw "server is booting"

  const runCheck = useCallback(async (force = false): Promise<boolean> => {
    const cfg = configRef.current;
    const ttl = cfg.cacheTtlMs ?? 14 * 60 * 1000;

    // Cross-tab cache check: if Tab 1 or any tab woke the server within cacheTtlMs (14m), skip network ping!
    if (isCacheValid(ttl) && !force) {
      console.log(
        "⚡ [wakeIt] Server already verified warm by browser session (localStorage). Skipping ping.",
      );
      setStatus("ready");
      return true;
    }

    if (activeCheckRef.current) return false;
    activeCheckRef.current = true;

    // Fresh start (mount or manual Retry click) resets counters; timer-driven retries keep them.
    const isAutoRetry = autoRetryRef.current;
    autoRetryRef.current = false;
    if (!isAutoRetry) {
      currentRetryRef.current = 0;
      bootStartRef.current = null;
      setRetryCount(0);
    }

    // While the platform is booting, stay in "warming" instead of flickering back to "checking".
    setStatus(bootStartRef.current !== null ? "warming" : "checking");

    const delayMs = cfg.showBannerDelayMs ?? 1500;
    const shouldShowWarmingBanner = cfg.showBannerOnWarmup ?? true;

    const showBannerTimer = setTimeout(() => {
      setStatus("warming");
      if (shouldShowWarmingBanner) setBannerVisible(true);
    }, delayMs);

    const startTime = performance.now();
    const targetUrl = cfg.healthEndpoint || "/api/health";

    console.log("⚡ [wakeIt] Initializing health check:", targetUrl);

    const timeoutMs = cfg.timeoutMs ?? 65000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      clearTimeout(showBannerTimer);

      if (response.ok) {
        const elapsed = Math.round(performance.now() - startTime);
        console.log(`🟢 [wakeIt] Backend is warm & ready! (${elapsed}ms)`);

        // Save cross-tab warm status permanently in localStorage
        setCacheValid();

        const wasBooting = bootStartRef.current !== null;
        const totalMs = wasBooting
          ? Math.round(Date.now() - (bootStartRef.current as number))
          : elapsed;
        bootStartRef.current = null;
        currentRetryRef.current = 0;

        setResponseTimeMs(totalMs);
        setStatus("ready");
        activeCheckRef.current = false;

        const showSuccessToast = cfg.showSuccessToast ?? true;
        const autoHideMs = cfg.autoHideMs ?? 4000;

        if ((wasBooting || elapsed > delayMs) && showSuccessToast) {
          setBannerVisible(true);
          if (autoHideMs > 0) {
            setTimeout(() => setBannerVisible(false), autoHideMs);
          }
        } else {
          setBannerVisible(false);
        }
        return true;
      } else {
        throw new HttpStatusError(response.status);
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      clearTimeout(showBannerTimer);
      console.warn("⚠️ [wakeIt] Health check ping failed:", err);
      activeCheckRef.current = false;

      const retryIntervalMs = cfg.retryIntervalMs ?? 5000;

      // 502/503/504 = platform is still booting the container, not a real failure.
      const isBooting =
        err instanceof HttpStatusError && BOOTING_STATUSES.includes(err.status);
      if (isBooting) {
        if (bootStartRef.current === null) bootStartRef.current = Date.now();
        const bootWindowMs = cfg.bootWindowMs ?? 90000;
        if (Date.now() - bootStartRef.current < bootWindowMs) {
          setStatus("warming");
          setBannerVisible(cfg.showBannerOnWarmup ?? true);
          setRetryCount((c) => c + 1);
          console.log(
            `⏳ [wakeIt] Server is booting (${(err as HttpStatusError).status}). Retrying in ${retryIntervalMs}ms...`,
          );
          if (retryTimeoutIdRef.current) clearTimeout(retryTimeoutIdRef.current);
          retryTimeoutIdRef.current = setTimeout(() => {
            autoRetryRef.current = true;
            runCheck(true);
          }, retryIntervalMs);
          return false;
        }
        // Boot window exhausted: give up for real (no more auto-retries).
        bootStartRef.current = null;
        console.log(`❌ [wakeIt] Server still not up after ${bootWindowMs}ms. Giving up.`);
        setStatus("error");
        setBannerVisible(cfg.showBannerOnError ?? false);
        return false;
      }

      setStatus("error");

      const showErrorBanner = cfg.showBannerOnError ?? false;
      setBannerVisible(showErrorBanner);

      const maxRetries = cfg.maxRetries ?? 3;
      const isEndless = maxRetries === "endless";

      if (isEndless || currentRetryRef.current < (maxRetries as number)) {
        currentRetryRef.current += 1;
        setRetryCount(currentRetryRef.current);
        const maxText = isEndless ? "Endless" : `${maxRetries}`;
        console.log(
          `🔄 [wakeIt] Retrying in ${retryIntervalMs}ms... (Attempt ${currentRetryRef.current}/${maxText})`,
        );

        if (retryTimeoutIdRef.current) {
          clearTimeout(retryTimeoutIdRef.current);
        }

        retryTimeoutIdRef.current = setTimeout(() => {
          autoRetryRef.current = true;
          runCheck(true);
        }, retryIntervalMs);
      } else {
        console.log(
          `❌ [wakeIt] Max retries (${maxRetries}) reached. Stopping retries.`,
        );
        setRetryCount(currentRetryRef.current);
      }

      return false;
    }
  }, []);

  useEffect(() => {
    runCheck();
    return () => {
      if (retryTimeoutIdRef.current) {
        clearTimeout(retryTimeoutIdRef.current);
      }
    };
  }, [runCheck]);

  const dismissBanner = useCallback(() => {
    setBannerVisible(false);
  }, []);

  return (
    <WakeItContext.Provider
      value={{
        status,
        isReady: status === "ready",
        isWarming: status === "warming",
        responseTimeMs,
        retryCount,
        bannerVisible,
        config: mergedConfig,
        checkBackend: runCheck,
        dismissBanner,
      }}
    >
      {children}
    </WakeItContext.Provider>
  );
}

export function useWakeIt() {
  const context = useContext(WakeItContext);
  if (!context) {
    throw new Error("useWakeIt must be used within a WakeItProvider");
  }
  return context;
}
