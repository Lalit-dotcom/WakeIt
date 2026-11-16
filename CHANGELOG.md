# Changelog

## 1.1.0

### Fixed
- The package now loads under native Node ESM and webpack 5. Version 1.0.0 emitted imports without file extensions. The build now produces one ESM file and one CommonJS file with type declarations.
- A cached "warm" state could report `ready` while the server was asleep, because the cache was trusted without any request. The cached state is now confirmed by one background probe (`verifyCachedState`, on by default).
- The warm cache was shared by every endpoint on the same origin. It is now stored per endpoint.
- Unmounting during a probe or a pending retry no longer leaves requests or timers running.
- The "waking up" title no longer fades in and out. At its faintest point the fading text failed the WCAG AA colour-contrast check; only the icon is animated now.

### Changed
- No runtime dependencies. `lucide-react` is removed and the banner no longer needs Tailwind CSS. Icons are inline SVG and styles are inline, themeable with CSS custom properties.
- Retries use exponential back-off with jitter by default (`retryBackoff`, `retryMaxIntervalMs`). The default base delay is 2 s (was a fixed 5 s). While a platform reports 502/503/504, polls stay at or below 5 s.
- The default banner text no longer names one hosting provider or quotes a boot time.
- Console logging is off unless `debug: true`.
- The localStorage key changed from `wakeit_backend_warmup_ts` to `wakeit:warm:<endpoint>`. Use `getWakeItCacheKey(endpoint)` instead of the literal key.

### Added
- `platform` presets (`render`, `railway`, `fly`, `koyeb`, `heroku`, `custom`) that set a cache lifetime below each platform's documented idle timeout.
- `prewarm(endpoint)`, usable outside React.
- `onEvent` callback with timestamped lifecycle events.
- ARIA live region, accessible button names, focus ring, reduced-motion support.
- `announcement` field on `useWakeIt()`.
- Test suite grown from 8 to 31 cases, with a coverage report and an axe-core accessibility check.

## 1.0.0

- First release.
