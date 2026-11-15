import type { CSSProperties, ReactNode } from "react";
import { useWakeIt } from "./wakeit.context";
import type { WakeItBannerPosition } from "./wakeit.config";

/**
 * The banner needs no CSS framework and no icon package. Colours can be themed
 * with CSS custom properties on any ancestor element:
 *   --wakeit-bg, --wakeit-fg, --wakeit-muted, --wakeit-border,
 *   --wakeit-warming, --wakeit-ready, --wakeit-error, --wakeit-button-bg
 */

const positionStyles: Record<WakeItBannerPosition, CSSProperties> = {
  "bottom-right": { bottom: 20, right: 20 },
  "bottom-left": { bottom: 20, left: 20 },
  "top-right": { top: 20, right: 20 },
  "top-left": { top: 20, left: 20 },
  "bottom-center": { bottom: 20, left: "50%", transform: "translateX(-50%)" },
  "top-center": { top: 20, left: "50%", transform: "translateX(-50%)" },
};

const KEYFRAMES = `
@keyframes wakeit-spin { to { transform: rotate(360deg); } }
@keyframes wakeit-pulse { 50% { opacity: .45; } }
.wakeit-spin { animation: wakeit-spin 1s linear infinite; transform-origin: center; }
.wakeit-pulse { animation: wakeit-pulse 1.6s ease-in-out infinite; }
.wakeit-btn:focus-visible { outline: 2px solid var(--wakeit-fg, #f4f4f5); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .wakeit-spin, .wakeit-pulse { animation: none; }
}`;

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const boxStyle: CSSProperties = {
  position: "fixed",
  zIndex: 99999,
  boxSizing: "border-box",
  width: "calc(100% - 40px)",
  maxWidth: 360,
  padding: 14,
  borderRadius: 12,
  border: "1px solid var(--wakeit-border, #27272a)",
  background: "var(--wakeit-bg, #09090b)",
  color: "var(--wakeit-fg, #f4f4f5)",
  boxShadow: "0 20px 40px rgba(0, 0, 0, 0.35)",
  font: "500 12px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12 };
const titleStyle: CSSProperties = { margin: 0, fontWeight: 600 };
const subStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: "var(--wakeit-muted, #a1a1aa)",
};
const iconButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "var(--wakeit-muted, #a1a1aa)",
  cursor: "pointer",
};
const retryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 8px",
  border: 0,
  borderRadius: 6,
  background: "var(--wakeit-button-bg, #27272a)",
  color: "var(--wakeit-fg, #f4f4f5)",
  font: "inherit",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

function Icon({
  size = 16,
  color,
  className,
  children,
}: {
  size?: number;
  color: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

const WARMING = "var(--wakeit-warming, #fbbf24)";
const READY = "var(--wakeit-ready, #34d399)";
const ERROR = "var(--wakeit-error, #fb7185)";

export function WakeItBanner() {
  const {
    status,
    responseTimeMs,
    bannerVisible,
    announcement,
    config,
    checkBackend,
    dismissBanner,
  } = useWakeIt();

  const msgs = config.messages || {};
  const dismissLabel = msgs.dismissButtonLabel || "Dismiss server status";

  const dismissButton = (
    <button
      type="button"
      className="wakeit-btn"
      onClick={dismissBanner}
      aria-label={dismissLabel}
      style={iconButtonStyle}
    >
      <Icon size={14} color="currentColor">
        <path d="M18 6 6 18M6 6l12 12" />
      </Icon>
    </button>
  );

  return (
    <>
      {/* Always in the DOM so screen readers announce changes to its text. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-wakeit-live=""
        style={visuallyHidden}
      >
        {announcement}
      </div>

      {bannerVisible && (
        <div
          role="group"
          aria-label="Server status"
          data-wakeit-banner={status}
          style={{
            ...boxStyle,
            ...positionStyles[config.position || "bottom-right"],
          }}
        >
          <style>{KEYFRAMES}</style>
          <div style={rowStyle}>
            {status === "warming" && (
              <>
                <Icon size={20} color={WARMING} className="wakeit-spin">
                  <path d="M21 12a9 9 0 1 1-6.2-8.56" />
                </Icon>
                <div style={{ flex: 1 }}>
                  <p
                    className="wakeit-pulse"
                    style={{ ...titleStyle, color: WARMING }}
                  >
                    {msgs.warming || "Waking up server..."}
                  </p>
                  <p style={subStyle}>
                    {msgs.warmingSubtext ||
                      "The server is starting. This can take up to a minute on free hosting."}
                  </p>
                </div>
              </>
            )}

            {status === "ready" && (
              <>
                <Icon color={READY}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="m8.5 12.5 2.5 2.5 4.5-5" />
                </Icon>
                <div style={{ flex: 1 }}>
                  <p style={{ ...titleStyle, color: READY }}>
                    {msgs.ready || "Server Warm & Ready!"}
                  </p>
                  {responseTimeMs !== null && (
                    <p style={subStyle}>Response time: {responseTimeMs}ms</p>
                  )}
                </div>
                {dismissButton}
              </>
            )}

            {status === "error" && (
              <>
                <Icon color={ERROR}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </Icon>
                <div style={{ flex: 1 }}>
                  <p style={{ ...titleStyle, color: ERROR }}>
                    {msgs.error || "Server connection delayed"}
                  </p>
                  <p style={subStyle}>
                    {msgs.errorSubtext ||
                      "Click retry to contact the server again."}
                  </p>
                </div>
                <button
                  type="button"
                  className="wakeit-btn"
                  onClick={() => checkBackend(true)}
                  style={retryButtonStyle}
                >
                  <Icon size={12} color="currentColor">
                    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5" />
                  </Icon>
                  {msgs.retryButtonText || "Retry"}
                </button>
                {dismissButton}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
