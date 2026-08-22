import { useWakeIt } from "./wakeit.context";
import type { WakeItBannerPosition } from "./wakeit.config";
import { Loader2, Zap, CheckCircle2, AlertCircle, RefreshCw, X } from "lucide-react";

const positionClasses: Record<WakeItBannerPosition, string> = {
  "bottom-right": "bottom-5 right-5",
  "bottom-left": "bottom-5 left-5",
  "top-right": "top-5 right-5",
  "top-left": "top-5 left-5",
  "bottom-center": "bottom-5 left-1/2 -translate-x-1/2",
  "top-center": "top-5 left-1/2 -translate-x-1/2",
};

export function WakeItBanner() {
  const {
    status,
    responseTimeMs,
    bannerVisible,
    config,
    checkBackend,
    dismissBanner,
  } = useWakeIt();

  if (!bannerVisible) return null;

  const posClass = positionClasses[config.position || "bottom-right"];
  const msgs = config.messages || {};

  return (
    <div
      className={`fixed ${posClass} z-[99999] w-full max-w-xs sm:max-w-sm rounded-xl border border-zinc-800 bg-zinc-950/95 p-3.5 shadow-2xl backdrop-blur-md text-xs font-medium text-zinc-100 transition-all duration-300 animate-in fade-in`}
    >
      <div className="flex items-center gap-3">
        {status === "warming" && (
          <>
            <div className="relative flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-amber-400 animate-pulse" />
              <Loader2 className="absolute -inset-1 h-6 w-6 animate-spin text-amber-400/40" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-amber-300">
                {msgs.warming || "Waking up server..."}
              </p>
              <p className="text-[11px] text-zinc-400 leading-tight">
                {msgs.warmingSubtext ||
                  "Render cold-start in progress (~30-50s). UI is ready!"}
              </p>
            </div>
          </>
        )}

        {status === "ready" && (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-emerald-300">
                {msgs.ready || "Server Warm & Ready!"}
              </p>
              {responseTimeMs !== null && (
                <p className="text-[11px] text-zinc-400">
                  Response time: {responseTimeMs}ms
                </p>
              )}
            </div>
            <button
              onClick={dismissBanner}
              className="text-zinc-400 hover:text-zinc-100 transition-colors p-1"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-rose-300">
                {msgs.error || "Server connection delayed"}
              </p>
              <p className="text-[11px] text-zinc-400">
                {msgs.errorSubtext || "Click retry to ping backend."}
              </p>
            </div>
            <button
              onClick={() => checkBackend(true)}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              {msgs.retryButtonText || "Retry"}
            </button>
            <button
              onClick={dismissBanner}
              className="text-zinc-400 hover:text-zinc-100 transition-colors p-1"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
