import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultWakeItConfig,
  resolveCacheTtlMs,
  type WakeItConfig,
  type WakeItEvent,
  type WakeItEventType,
} from "./wakeit.config";
import {
  BOOTING_STATUSES,
  computeRetryDelayMs,
  isCacheValid,
  setCacheValid,
} from "./wakeit.core";

export type WakeItStatus = "idle" | "checking" | "warming" | "ready" | "error";

export type WakeItState = {
  status: WakeItStatus;
  isReady: boolean;
  isWarming: boolean;
  responseTimeMs: number | null;
  retryCount: number;
  bannerVisible: boolean;
  /** Text for assistive technology; changes when the state is worth announcing. */
  announcement: string;
  config: WakeItConfig;
  checkBackend: (force?: boolean) => Promise<boolean>;
  dismissBanner: () => void;
};

export type WakeItProviderProps = {
  children: ReactNode;
  /** Partial or full WakeItConfig override. Falls back to defaultWakeItConfig. */
  config?: WakeItConfig;
  /** Shorthand for the health check endpoint URL */
  healthEndpoint?: string;
};

const WakeItContext = createContext<WakeItState | null>(null);

/** While the platform reports "booting", never wait longer than this between polls. */
const BOOT_POLL_MAX_MS = 5000;

class HttpStatusError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP status ${status}`);
    this.status = status;
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

  const [status, setStatus] = useState<WakeItStatus>(() =>
    isCacheValid(
      mergedConfig.healthEndpoint || "/api/health",
      resolveCacheTtlMs(mergedConfig),
    )
      ? "ready"
      : "idle",
  );
  const [responseTimeMs, setResponseTimeMs] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const statusRef = useRef<WakeItStatus>(status);
  const activeCheckRef = useRef<boolean>(false);
  const currentRetryRef = useRef<number>(0);
  const bootAttemptRef = useRef<number>(0);
  const autoRetryRef = useRef<boolean>(false); // true only when the retry timer calls runCheck
  const bootStartRef = useRef<number | null>(null); // when we first saw "server is booting"
  // Every mount gets a new generation; results from an older one are ignored.
  const generationRef = useRef<number>(0);
  const controllerRef = useRef<AbortController | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  const cancel = useCallback((id: ReturnType<typeof setTimeout> | null) => {
    if (id === null) return;
    clearTimeout(id);
    timersRef.current.delete(id);
  }, []);

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runCheck = useCallback(
    async (force = false): Promise<boolean> => {
      const cfg = configRef.current;
      const endpoint = cfg.healthEndpoint || "/api/health";
      const generation = generationRef.current;

      const log = (...args: unknown[]) => {
        if (cfg.debug) console.log("[wakeit]", ...args);
      };
      const emit = (
        type: WakeItEventType,
        extra: Partial<WakeItEvent> = {},
      ) => {
        if (!cfg.onEvent) return;
        try {
          cfg.onEvent({
            type,
            t: performance.now(),
            wallTime: Date.now(),
            endpoint,
            ...extra,
          });
        } catch {
          // A faulty listener must not break the probe.
        }
      };
      const updateStatus = (next: WakeItStatus) => {
        if (statusRef.current === next) return;
        statusRef.current = next;
        setStatus(next);
        emit("status_change", { status: next });
      };

      const cacheHit = !force && isCacheValid(endpoint, resolveCacheTtlMs(cfg));
      if (cacheHit && cfg.verifyCachedState === false) {
        log("Warm state found in cache. Skipping the probe.");
        updateStatus("ready");
        return true;
      }
      // A cached warm state is shown at once and confirmed by one quiet probe.
      const background = cacheHit;

      if (activeCheckRef.current) return false;
      activeCheckRef.current = true;

      // A fresh start (mount or manual retry) resets counters; timer-driven retries keep them.
      const isAutoRetry = autoRetryRef.current;
      autoRetryRef.current = false;
      if (!isAutoRetry) {
        currentRetryRef.current = 0;
        bootAttemptRef.current = 0;
        bootStartRef.current = null;
        setRetryCount(0);
      }

      if (background) {
        updateStatus("ready");
      } else {
        // While the platform is booting, stay in "warming" instead of flickering to "checking".
        updateStatus(bootStartRef.current !== null ? "warming" : "checking");
      }

      const delayMs = cfg.showBannerDelayMs ?? 1500;
      const shouldShowWarmingBanner = cfg.showBannerOnWarmup ?? true;
      const msgs = cfg.messages ?? {};

      const showBannerTimer = later(() => {
        updateStatus("warming");
        setAnnouncement(
          [msgs.warming, msgs.warmingSubtext].filter(Boolean).join(" "),
        );
        if (shouldShowWarmingBanner) setBannerVisible(true);
      }, delayMs);

      const startTime = performance.now();
      const timeoutMs = cfg.timeoutMs ?? 65000;
      const controller = new AbortController();
      controllerRef.current = controller;
      const timeoutId = later(() => controller.abort(), timeoutMs);

      log("Probing", endpoint, background ? "(cache re-check)" : "");
      emit("probe_start", { background });

      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (generation !== generationRef.current) return false;
        cancel(timeoutId);
        cancel(showBannerTimer);

        const elapsed = Math.round(performance.now() - startTime);
        emit("first_byte", { httpStatus: response.status, elapsedMs: elapsed });

        if (!response.ok) throw new HttpStatusError(response.status);

        log(`Backend is ready (${elapsed} ms)`);
        setCacheValid(endpoint);

        const wasBooting = bootStartRef.current !== null;
        const totalMs = wasBooting
          ? Math.round(Date.now() - (bootStartRef.current as number))
          : elapsed;
        bootStartRef.current = null;
        bootAttemptRef.current = 0;
        currentRetryRef.current = 0;

        setResponseTimeMs(totalMs);
        updateStatus("ready");
        emit("ready", { httpStatus: response.status, elapsedMs: totalMs });
        activeCheckRef.current = false;

        const wasSlow = wasBooting || elapsed > delayMs;
        if (wasSlow) setAnnouncement(msgs.ready ?? "");

        const autoHideMs = cfg.autoHideMs ?? 4000;
        if (wasSlow && (cfg.showSuccessToast ?? true)) {
          setBannerVisible(true);
          if (autoHideMs > 0) later(() => setBannerVisible(false), autoHideMs);
        } else {
          setBannerVisible(false);
        }
        return true;
      } catch (err: unknown) {
        // Unmounted (or remounted) while the request was in flight: stay silent.
        if (generation !== generationRef.current) return false;
        cancel(timeoutId);
        cancel(showBannerTimer);
        activeCheckRef.current = false;

        const httpStatus =
          err instanceof HttpStatusError ? err.status : undefined;
        log("Probe failed:", httpStatus ?? err);

        const baseMs = cfg.retryIntervalMs ?? 2000;
        const maxMs = cfg.retryMaxIntervalMs ?? 15000;
        const mode = cfg.retryBackoff ?? "exponential";

        const scheduleRetry = (waitMs: number, attempt: number) => {
          emit("retry_scheduled", { attempt, delayMs: waitMs, httpStatus });
          cancel(retryTimerRef.current);
          retryTimerRef.current = later(() => {
            autoRetryRef.current = true;
            runCheck(true);
          }, waitMs);
        };

        // 502/503/504 = the platform is still booting the container, not a real failure.
        const isBooting =
          httpStatus !== undefined && BOOTING_STATUSES.includes(httpStatus);
        if (isBooting) {
          if (bootStartRef.current === null) bootStartRef.current = Date.now();
          const bootWindowMs = cfg.bootWindowMs ?? 90000;
          if (Date.now() - bootStartRef.current < bootWindowMs) {
            updateStatus("warming");
            setAnnouncement(
              [msgs.warming, msgs.warmingSubtext].filter(Boolean).join(" "),
            );
            setBannerVisible(shouldShowWarmingBanner);
            bootAttemptRef.current += 1;
            setRetryCount((c) => c + 1);
            const waitMs = computeRetryDelayMs(
              bootAttemptRef.current,
              baseMs,
              Math.min(maxMs, BOOT_POLL_MAX_MS),
              mode,
            );
            log(`Server is booting (${httpStatus}). Next check in ${waitMs} ms.`);
            scheduleRetry(waitMs, bootAttemptRef.current);
            return false;
          }
          // Boot window used up: stop retrying.
          bootStartRef.current = null;
          log(`Server still not up after ${bootWindowMs} ms. Giving up.`);
          updateStatus("error");
          emit("error", { httpStatus });
          setAnnouncement(msgs.error ?? "");
          setBannerVisible(cfg.showBannerOnError ?? false);
          return false;
        }

        updateStatus("error");
        setBannerVisible(cfg.showBannerOnError ?? false);

        const maxRetries = cfg.maxRetries ?? 3;
        const isEndless = maxRetries === "endless";

        if (isEndless || currentRetryRef.current < (maxRetries as number)) {
          currentRetryRef.current += 1;
          setRetryCount(currentRetryRef.current);
          const waitMs = computeRetryDelayMs(
            currentRetryRef.current,
            baseMs,
            maxMs,
            mode,
          );
          log(
            `Retry ${currentRetryRef.current}/${isEndless ? "endless" : maxRetries} in ${waitMs} ms.`,
          );
          scheduleRetry(waitMs, currentRetryRef.current);
        } else {
          log(`Max retries (${maxRetries}) reached. Stopping.`);
          setRetryCount(currentRetryRef.current);
          emit("error", { httpStatus });
          setAnnouncement(msgs.error ?? "");
        }

        return false;
      }
    },
    [later, cancel],
  );

  useEffect(() => {
    runCheck();
    const timers = timersRef.current;
    return () => {
      // Invalidate anything still in flight and stop every pending timer.
      generationRef.current += 1;
      controllerRef.current?.abort();
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      retryTimerRef.current = null;
      activeCheckRef.current = false;
      autoRetryRef.current = false;
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
        announcement,
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
