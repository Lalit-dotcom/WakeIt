import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defaultWakeItConfig, type WakeItConfig } from "./wakeIt.config";

export type WakeItStatus = "idle" | "warming" | "ready" | "error";

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

  const runCheck = useCallback(
    async (force = false): Promise<boolean> => {
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

      setStatus("warming");

      const delayMs = cfg.showBannerDelayMs ?? 1500;
      const shouldShowWarmingBanner = cfg.showBannerOnWarmup ?? true;

      const showBannerTimer = setTimeout(() => {
        if (shouldShowWarmingBanner) {
          setBannerVisible(true);
        }
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

          setResponseTimeMs(elapsed);
          setStatus("ready");
          activeCheckRef.current = false;

          const showSuccessToast = cfg.showSuccessToast ?? true;
          const autoHideMs = cfg.autoHideMs ?? 4000;

          if (elapsed > delayMs && showSuccessToast) {
            setBannerVisible(true);
            if (autoHideMs > 0) {
              setTimeout(() => setBannerVisible(false), autoHideMs);
            }
          } else {
            setBannerVisible(false);
          }
          return true;
        } else {
          throw new Error(`HTTP status ${response.status}`);
        }
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        clearTimeout(showBannerTimer);
        console.warn("⚠️ [wakeIt] Health check ping failed:", err);
        activeCheckRef.current = false;
        setStatus("error");

        const showErrorBanner = cfg.showBannerOnError ?? false;
        setBannerVisible(showErrorBanner);

        const maxRetries = cfg.maxRetries ?? 3;
        const retryIntervalMs = cfg.retryIntervalMs ?? 5000;
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
            activeCheckRef.current = false;
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
    },
    [],
  );

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
