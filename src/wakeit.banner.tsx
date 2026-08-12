import { useWakeIt } from "./wakeIt.context";
import type { WakeItBannerPosition } from "./wakeIt.config";

const ZapIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </svg>
);

const LoaderIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const CheckCircleIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <path d="m9 11 3 3L22 4" />
  </svg>
);

const AlertCircleIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </svg>
);

const RefreshIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

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
              <ZapIcon className="h-4 w-4 text-amber-400 animate-pulse" />
              <LoaderIcon className="absolute -inset-1 h-6 w-6 animate-spin text-amber-400/40" />
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
            <CheckCircleIcon className="h-4 w-4 text-emerald-400 shrink-0" />
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
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircleIcon className="h-4 w-4 text-rose-400 shrink-0" />
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
              <RefreshIcon className="h-3 w-3" />
              {msgs.retryButtonText || "Retry"}
            </button>
            <button
              onClick={dismissBanner}
              className="text-zinc-400 hover:text-zinc-100 transition-colors p-1"
              title="Dismiss"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
