# ⚡ wakeit — Plug & Play Backend Pre-Warmer

**`wakeit`** is an ultra-lightweight, zero runtime dependency, plug-and-play React tool designed to solve cold-start delays on free-tier backend hosting platforms (Render, Railway, Fly.io, Heroku).

---

## ⚡ How It Works (Smart UX)

1. **Silent Health Check:** When a user lands on your app, `wakeit` silently pings your backend health endpoint.
2. **Server is Alive (<1.5s):** If the backend responds quickly, **no banner is shown** and warm status is saved to `localStorage`. Zero distraction!
3. **Server is Sleeping (>1.5s):** Render cold-starts take ~30-50s. After 1.5s (configurable delay), `wakeit` displays a clean floating badge (`⚡ Waking up server...`). Once Render finishes booting, it switches to green (`🟢 Server Warm & Ready!`) and auto-hides!
4. **Persistent Cross-Tab Cache:** Once verified warm, `wakeit` caches status in `localStorage` (default 14 minutes) so F5 refreshes and new browser tabs skip unnecessary health checks.

---


*Note: Requires `react` and `react-dom` (v18 or v19) as peer dependencies.*

---

## 🚀 Quick Setup

### 1. Wrap your Root Component

```tsx
import { WakeItProvider, WakeItBanner } from "wakeit";

export default function App() {
  return (
    <WakeItProvider healthEndpoint="https://your-api.onrender.com/api/health">
      <YourAppRoutes />
      <WakeItBanner />
    </WakeItProvider>
  );
}
```

### 2. Use the Hook in Any Component (Optional)

```tsx
import { useWakeIt } from "wakeit";

function PlayButton() {
  const { isReady, isWarming, responseTimeMs } = useWakeIt();

  return (
    <button disabled={isWarming}>
      {isWarming ? "Server starting..." : "Start Game"}
    </button>
  );
}
```

---

## ⚙️ Configuration (`WakeItConfig`)

Customize behavior globally via the `config` prop or `defaultWakeItConfig`:

```typescript
import { WakeItProvider, type WakeItConfig } from "wakeit";

const customConfig: WakeItConfig = {
  // Health check endpoint
  healthEndpoint: "https://your-api.onrender.com/api/health",

  // Screen placement: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'top-center'
  position: "bottom-right",

  // Visual Toggles
  showBannerOnWarmup: true,   // Show yellow 'Waking up server...' banner
  showSuccessToast: true,     // Show green 'Server Warm & Ready!' toast
  showBannerOnError: false,   // Set true to show red alert banner on health check failure

  // Retries & Timing
  maxRetries: 3,              // Number of retries (or 'endless' for continuous auto-retries)
  retryIntervalMs: 5000,      // Delay between retry attempts (ms)
  bootWindowMs: 90000,        // Keep retrying this long (ms) while server answers 502/503/504 (still booting)
  showBannerDelayMs: 1500,    // Delay threshold before popping up banner (ms)
  timeoutMs: 65000,           // Request timeout before aborting ping (ms)
  autoHideMs: 4000,           // Duration before success toast auto-hides (ms)
  cacheTtlMs: 14 * 60 * 1000, // localStorage cache duration (14 minutes)

  // Custom UI Messages
  messages: {
    warming: "Waking up server...",
    warmingSubtext: "Render cold-start in progress (~30-50s). UI is ready!",
    ready: "Server Warm & Ready!",
    error: "Server connection delayed",
    errorSubtext: "Click retry to ping backend.",
    retryButtonText: "Retry",
  },
};
```

---

## 📄 License

MIT © wakeit
