# WakeIt

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24299374.svg)](https://doi.org/10.5281/zenodo.24299374)

**WakeIt** is a small React library for apps whose backend goes to sleep when idle (Render free tier, Railway Serverless, Fly.io auto-stop, Koyeb free instance, Heroku Eco).

When the page loads, WakeIt sends one request to your health endpoint. This starts the server's boot early, while the user is still reading the page. If the server is slow to answer, WakeIt shows a small status badge and lets you keep buttons disabled until the backend is ready.

WakeIt does **not** make the server boot faster. It overlaps the boot with the time the user spends on the page, and it tells the user what is happening.

- No runtime dependencies. React 18 or 19 is the only peer dependency.
- No CSS framework needed: the badge is styled inline.
- About 4.3 kB minified and gzipped.
- Screen-reader announcements through an ARIA live region.
- Ships as ESM and CommonJS with TypeScript types.

## Install

```bash
npm install @lalit_kumar/wakeit
```

## Quick start

```tsx
import { WakeItProvider, WakeItBanner } from "@lalit_kumar/wakeit";

export default function App() {
  return (
    <WakeItProvider
      healthEndpoint="https://your-api.onrender.com/api/health"
      config={{ platform: "render" }}
    >
      <YourRoutes />
      <WakeItBanner />
    </WakeItProvider>
  );
}
```

Your backend needs a cheap `GET` endpoint that returns a 2xx status, and CORS must allow your front end's origin.

### Disable controls until the server is ready

```tsx
import { useWakeIt } from "@lalit_kumar/wakeit";

function SaveButton() {
  const { isReady, isWarming } = useWakeIt();
  return (
    <button disabled={!isReady}>
      {isWarming ? "Server starting..." : "Save"}
    </button>
  );
}
```

### Start the boot even earlier

`prewarm()` works without React. Call it from a landing page, or when the user hovers a link that leads into the app.

```ts
import { prewarm } from "@lalit_kumar/wakeit";

loginLink.addEventListener("pointerenter", () => {
  prewarm("https://your-api.onrender.com/api/health");
});
```

## How it behaves

1. **Probe on mount.** The provider sends `GET healthEndpoint`.
2. **Fast reply (under 1.5 s by default).** Nothing is shown.
3. **Slow reply.** After 1.5 s the status becomes `warming` and the badge appears. When the server answers, a short "ready" message is shown.
4. **502, 503 or 504.** Some platforms return these while the container boots. WakeIt treats them as "still booting" and keeps polling, at most every 5 s, for up to `bootWindowMs`.
5. **Other failures.** Retried up to `maxRetries` times with exponential back-off and jitter.
6. **Warm cache.** A successful probe is remembered in `localStorage`, per endpoint. On the next page load the UI starts as `ready`, and one background probe confirms it. If that probe is slow, the state drops back to `warming`.

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `healthEndpoint` | `"/api/health"` | URL to probe. |
| `platform` | `"custom"` | `render`, `railway`, `fly`, `koyeb`, `heroku` or `custom`. Sets the warm-cache lifetime below that platform's idle timeout. |
| `cacheTtlMs` | from `platform` | Warm-cache lifetime. Overrides the preset. |
| `verifyCachedState` | `true` | Confirm a cached warm state with one background probe. `false` trusts the cache and sends nothing. |
| `showBannerDelayMs` | `1500` | Wait this long before showing the badge. |
| `timeoutMs` | `65000` | Abort one probe after this long. |
| `maxRetries` | `3` | Retries after a real failure. A number or `"endless"`. |
| `retryIntervalMs` | `2000` | Base retry delay. |
| `retryBackoff` | `"exponential"` | `"exponential"` (with jitter) or `"fixed"`. |
| `retryMaxIntervalMs` | `15000` | Upper limit for one retry delay. |
| `bootWindowMs` | `90000` | How long 502/503/504 count as "still booting". |
| `showBannerOnWarmup` | `true` | Show the badge while warming. |
| `showSuccessToast` | `true` | Show the "ready" message after a slow start. |
| `showBannerOnError` | `false` | Show the error badge with a Retry button. |
| `autoHideMs` | `4000` | Hide the "ready" message after this long. `0` keeps it. |
| `position` | `"bottom-right"` | One of six screen positions. |
| `debug` | `false` | Log to the console. |
| `onEvent` | none | Receives timestamped lifecycle events. |
| `messages` | English text | Override any label. |

Warm-cache lifetime per platform preset:

| Preset | Cache lifetime | Documented idle timeout |
|---|---|---|
| `render` | 14 min | 15 min without inbound traffic |
| `railway` | 4 min | about 5 min without outbound traffic |
| `fly` | 2 min | not stated exactly; the proxy checks every few minutes |
| `koyeb` | 55 min | 1 hour without traffic (free instance) |
| `heroku` | 28 min | 30 min without web traffic (Eco dynos) |
| `custom` | 14 min | set `cacheTtlMs` yourself |

Providers change these values. Check the provider's documentation for your plan.

## `useWakeIt()`

| Field | Type | Meaning |
|---|---|---|
| `status` | `"idle" \| "checking" \| "warming" \| "ready" \| "error"` | Current state. |
| `isReady`, `isWarming` | `boolean` | Shortcuts. |
| `responseTimeMs` | `number \| null` | Time until the server answered. |
| `retryCount` | `number` | Retries so far. |
| `bannerVisible` | `boolean` | Whether the badge is shown. |
| `announcement` | `string` | Text sent to screen readers. |
| `checkBackend(force?)` | function | Probe again. |
| `dismissBanner()` | function | Hide the badge. |

## Events

`onEvent` receives objects with `type`, `t` (from `performance.now()`), `wallTime`, `endpoint` and, depending on the type, `status`, `httpStatus`, `elapsedMs`, `attempt`, `delayMs` and `background`. Types: `probe_start`, `first_byte`, `status_change`, `retry_scheduled`, `ready`, `error`.

## Theming

Set CSS custom properties on any ancestor of the badge:

```css
:root {
  --wakeit-bg: #ffffff;
  --wakeit-fg: #18181b;
  --wakeit-muted: #52525b;
  --wakeit-border: #e4e4e7;
  --wakeit-warming: #b45309;
  --wakeit-ready: #047857;
  --wakeit-error: #be123c;
  --wakeit-button-bg: #f4f4f5;
}
```

## Accessibility

- A visually hidden `role="status"` region announces "waking up", "ready" and error messages. A fast server produces no announcement.
- Buttons are real `<button>` elements with accessible names and a visible focus ring.
- Animations stop when the user has asked for reduced motion.

## Limits

- WakeIt cannot shorten the boot. A user who acts the instant the page loads still waits for it.
- The backend needs a reachable health endpoint with CORS enabled.
- A probe is a real request. It wakes a sleeping server, which uses free-tier hours just as a normal visit would.

## Development

```bash
npm install
npm test               # unit tests
npm run test:coverage  # with coverage
npm run build          # ESM + CJS + types into dist/
npm run smoke          # load the build under Node ESM and CJS
npm run size           # minified + gzipped size
```

`example/server` is a cold-start simulator. `example/vite_demo` is a demo app. `bench/` holds the measurement tools used for the paper.

## Citing

If you use WakeIt in research, please cite it through Zenodo. Version 1.1.0 is [doi:10.5281/zenodo.24299376](https://doi.org/10.5281/zenodo.24299376); to cite every version together (including later ones such as 1.1.1), use the concept DOI [10.5281/zenodo.24299374](https://doi.org/10.5281/zenodo.24299374). GitHub's "Cite this repository" button reads the same details from `CITATION.cff`.

## License

MIT
