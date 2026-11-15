import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import axe from "axe-core";
import {
  WakeItProvider,
  WakeItBanner,
  useWakeIt,
  prewarm,
  getWakeItCacheKey,
  computeRetryDelayMs,
  resolveCacheTtlMs,
  WAKEIT_PLATFORM_CACHE_TTL_MS,
  type WakeItConfig,
  type WakeItEvent,
} from "../src";

const URL = "/api/health";
const CACHE_KEY = getWakeItCacheKey(URL);

type Init = { signal?: AbortSignal } | undefined;

/** A response that arrives after `delayMs` and rejects if the request is aborted. */
function delayed(delayMs: number, status: number, init: Init) {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(
      () => resolve({ ok: status < 400, status } as Response),
      delayMs,
    );
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** fetch mock: responds after `delayMs` with the given status */
function mockFetch(delayMs: number, status = 200) {
  const fn = vi.fn((_url: string, init?: Init) => delayed(delayMs, status, init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** fetch mock: answers `bootStatus` until `bootMs` after the first call, then 200 */
function mockBooting(bootMs: number, bootStatus = 503) {
  const t0 = Date.now();
  const fn = vi.fn(async () => {
    const up = Date.now() - t0 >= bootMs;
    return { ok: up, status: up ? 200 : bootStatus } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function Probe() {
  const { status, isReady, isWarming } = useWakeIt();
  return (
    <div data-testid="probe">
      {status}|{String(isReady)}|{String(isWarming)}
    </div>
  );
}

function setup(config: WakeItConfig = {}, endpoint = URL) {
  return render(
    <WakeItProvider healthEndpoint={endpoint} config={config}>
      <Probe />
      <WakeItBanner />
    </WakeItProvider>,
  );
}

const probeText = () => screen.getByTestId("probe").textContent;
/** True when the visible banner (not the screen-reader region) shows the text. */
const bannerShows = (text: RegExp) =>
  text.test(document.querySelector("[data-wakeit-banner]")?.textContent ?? "");
const liveRegion = () =>
  document.querySelector("[data-wakeit-live]") as HTMLElement;

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WakeIt: probe and banner", () => {
  it("TC-01: fast server (<1.5s) stays silent and saves warm cache", async () => {
    const f = mockFetch(100);
    setup();
    await tick(200);

    expect(f).toHaveBeenCalledTimes(1);
    expect(probeText()).toContain("ready|true");
    expect(bannerShows(/Waking up server/)).toBe(false);
    expect(bannerShows(/Server Warm & Ready/)).toBe(false);
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });

  it("TC-02: slow server (>1.5s) shows warming badge, then ready toast that auto-hides", async () => {
    mockFetch(5000);
    setup();

    await tick(1600);
    expect(bannerShows(/Waking up server/)).toBe(true);
    expect(probeText()).toContain("warming|false|true");

    await tick(3600); // server answers at 5000ms total
    expect(bannerShows(/Server Warm & Ready/)).toBe(true);

    await tick(4100); // autoHideMs = 4000
    expect(bannerShows(/Server Warm & Ready/)).toBe(false);
  });

  it("TC-03: with verifyCachedState off, a valid cache skips the network probe entirely", async () => {
    localStorage.setItem(CACHE_KEY, Date.now().toString());
    const f = mockFetch(100);
    setup({ verifyCachedState: false });
    await tick(200);

    expect(f).not.toHaveBeenCalled();
    expect(probeText()).toContain("ready|true");
  });

  it("TC-04: expired cache triggers a fresh probe", async () => {
    const old = Date.now() - 15 * 60 * 1000; // older than the 14 min default
    localStorage.setItem(CACHE_KEY, old.toString());
    const f = mockFetch(100);
    setup();
    await tick(200);

    expect(f).toHaveBeenCalledTimes(1);
    expect(Number(localStorage.getItem(CACHE_KEY))).toBeGreaterThan(old);
  });

  it("TC-05: failing backend retries maxRetries times, then ends in error with retry button", async () => {
    const f = mockFetch(50, 500);
    setup({
      maxRetries: 2,
      retryIntervalMs: 1000,
      retryBackoff: "fixed",
      showBannerOnError: true,
    });
    await tick(5000);

    expect(f).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(probeText()).toContain("error");
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe("WakeIt: retry logic on booting platforms", () => {
  it("TC-06: fast 503s while booting do not exhaust maxRetries; ends ready with toast", async () => {
    const f = mockBooting(40000);
    setup({ retryBackoff: "fixed", retryIntervalMs: 5000 });

    await tick(10000);
    expect(probeText()).toContain("warming"); // never flips to error
    expect(bannerShows(/Waking up server/)).toBe(true);

    await tick(32000); // total 42s; server is up at 40s, toast still visible
    expect(probeText()).toContain("ready|true");
    expect(bannerShows(/Server Warm & Ready/)).toBe(true);
    expect(f.mock.calls.length).toBeGreaterThan(4); // more than 1 + maxRetries(3)
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });

  it("TC-07: gives up with error after bootWindowMs if server never comes up", async () => {
    const f = mockBooting(10 * 60 * 1000);
    setup({
      bootWindowMs: 20000,
      retryIntervalMs: 5000,
      retryBackoff: "fixed",
      showBannerOnError: true,
    });
    await tick(60000);

    expect(probeText()).toContain("error");
    expect(screen.getByText("Retry")).toBeTruthy();
    const calls = f.mock.calls.length;
    await tick(60000); // no further auto-retries once given up
    expect(f.mock.calls.length).toBe(calls);
  });

  it("TC-08: 404 (real failure, not booting) still follows maxRetries", async () => {
    const f = mockFetch(50, 404);
    setup({ maxRetries: 2, retryIntervalMs: 1000, retryBackoff: "fixed" });
    await tick(10000);
    expect(f).toHaveBeenCalledTimes(3);
    expect(probeText()).toContain("error");
  });

  it("TC-09: while booting, polls stay at or below 5 s even with exponential back-off", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1); // longest possible delays
    const f = mockBooting(30000);
    setup(); // defaults: exponential, base 2000, cap 15000
    await tick(31000);
    // delays 2 s, 4 s, then capped at 5 s: 0, 2, 6, 11, 16, 21, 26, 31 s
    expect(f.mock.calls.length).toBe(8);
    expect(probeText()).toContain("ready|true");
  });
});

describe("WakeIt: back-off", () => {
  it("TC-10: computeRetryDelayMs is fixed, doubles, caps and stays within jitter bounds", () => {
    expect(computeRetryDelayMs(1, 1000, 8000, "fixed")).toBe(1000);
    expect(computeRetryDelayMs(5, 1000, 8000, "fixed")).toBe(1000);

    const top = (n: number) => computeRetryDelayMs(n, 1000, 8000, "exponential", () => 1);
    const bottom = (n: number) => computeRetryDelayMs(n, 1000, 8000, "exponential", () => 0);
    expect([1, 2, 3, 4, 5, 9].map(top)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
    expect([1, 2, 3, 4].map(bottom)).toEqual([500, 1000, 2000, 4000]);

    for (let i = 0; i < 200; i++) {
      const d = computeRetryDelayMs(3, 1000, 8000, "exponential");
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });

  it("TC-11: failed probes are retried with growing delays", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const f = mockFetch(0, 500);
    setup({ maxRetries: 3, retryIntervalMs: 1000, retryMaxIntervalMs: 60000 });

    await tick(900);
    expect(f).toHaveBeenCalledTimes(1);
    await tick(200); // 1.1 s: first retry after 1 s
    expect(f).toHaveBeenCalledTimes(2);
    await tick(1500); // 2.6 s: second retry needs 1 + 2 = 3 s
    expect(f).toHaveBeenCalledTimes(2);
    await tick(600); // 3.2 s
    expect(f).toHaveBeenCalledTimes(3);
    await tick(4000); // 7.2 s: third retry at 1 + 2 + 4 = 7 s
    expect(f).toHaveBeenCalledTimes(4);
    await tick(60000);
    expect(f).toHaveBeenCalledTimes(4); // maxRetries reached
  });

  it("TC-12: a request that never answers is aborted after timeoutMs and retried", async () => {
    const f = mockFetch(10 * 60 * 1000);
    setup({
      timeoutMs: 3000,
      maxRetries: 1,
      retryIntervalMs: 1000,
      retryBackoff: "fixed",
    });
    await tick(2900);
    expect(f).toHaveBeenCalledTimes(1);
    await tick(200); // aborted at 3 s
    expect(probeText()).toContain("error");
    await tick(1000); // one retry
    expect(f).toHaveBeenCalledTimes(2);
    const signal = (f.mock.calls[0][1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(true);
  });
});

describe("WakeIt: warm-state cache", () => {
  it("TC-13: a cached warm state shows ready at once and is confirmed by one quiet probe", async () => {
    const stamp = Date.now() - 60_000;
    localStorage.setItem(CACHE_KEY, stamp.toString());
    const f = mockFetch(100);
    setup();

    expect(probeText()).toContain("ready|true"); // before any reply
    await tick(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(probeText()).toContain("ready|true");
    expect(bannerShows(/Waking up server/)).toBe(false);
    expect(bannerShows(/Server Warm & Ready/)).toBe(false);
    expect(Number(localStorage.getItem(CACHE_KEY))).toBeGreaterThan(stamp);
  });

  it("TC-14: a stale 'warm' cache is corrected when the server is in fact asleep", async () => {
    localStorage.setItem(CACHE_KEY, Date.now().toString());
    mockFetch(8000); // the server is cold-starting
    setup();

    expect(probeText()).toContain("ready|true");
    await tick(1600);
    expect(probeText()).toContain("warming|false|true");
    expect(bannerShows(/Waking up server/)).toBe(true);
    await tick(6500);
    expect(probeText()).toContain("ready|true");
    expect(bannerShows(/Server Warm & Ready/)).toBe(true);
  });

  it("TC-15: the warm cache is scoped to one endpoint", async () => {
    localStorage.setItem(getWakeItCacheKey("/a/api/health"), Date.now().toString());
    const f = mockFetch(100);
    setup({ verifyCachedState: false }, "/b/api/health");
    expect(probeText()).not.toContain("ready"); // the flag belongs to /a
    await tick(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(getWakeItCacheKey("/b/api/health"))).not.toBeNull();
  });

  it("TC-16: platform presets use a cache lifetime shorter than the platform's idle timeout", async () => {
    expect(WAKEIT_PLATFORM_CACHE_TTL_MS.render).toBeLessThan(15 * 60 * 1000);
    expect(WAKEIT_PLATFORM_CACHE_TTL_MS.railway).toBeLessThan(5 * 60 * 1000);
    expect(WAKEIT_PLATFORM_CACHE_TTL_MS.koyeb).toBeLessThan(60 * 60 * 1000);
    expect(WAKEIT_PLATFORM_CACHE_TTL_MS.heroku).toBeLessThan(30 * 60 * 1000);
    expect(resolveCacheTtlMs({ platform: "fly" })).toBe(WAKEIT_PLATFORM_CACHE_TTL_MS.fly);
    expect(resolveCacheTtlMs({ platform: "fly", cacheTtlMs: 1234 })).toBe(1234);
    expect(resolveCacheTtlMs({})).toBe(WAKEIT_PLATFORM_CACHE_TTL_MS.custom);

    // A 5-minute-old flag is still valid for Render but expired for Railway.
    localStorage.setItem(CACHE_KEY, (Date.now() - 5 * 60 * 1000).toString());
    mockFetch(100);
    const first = setup({ platform: "render", verifyCachedState: false });
    expect(probeText()).toContain("ready");
    first.unmount();
    setup({ platform: "railway", verifyCachedState: false });
    expect(probeText()).not.toContain("ready");
  });
});

describe("WakeIt: lifecycle safety", () => {
  it("TC-17: React StrictMode double mount still ends in ready", async () => {
    const f = mockFetch(100);
    render(
      <StrictMode>
        <WakeItProvider healthEndpoint={URL}>
          <Probe />
          <WakeItBanner />
        </WakeItProvider>
      </StrictMode>,
    );
    await tick(300);
    expect(probeText()).toContain("ready|true");
    expect(f.mock.calls.length).toBeLessThanOrEqual(2);
    // the request from the discarded first mount was aborted
    if (f.mock.calls.length === 2) {
      expect((f.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    }
  });

  it("TC-18: unmounting while a retry is pending stops further requests", async () => {
    const f = mockFetch(50, 500);
    const view = setup({ maxRetries: "endless", retryIntervalMs: 1000, retryBackoff: "fixed" });
    await tick(1500);
    const calls = f.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    view.unmount();
    await tick(20000);
    expect(f.mock.calls.length).toBe(calls);
  });

  it("TC-19: unmounting during a probe aborts it and writes no cache", async () => {
    const f = mockFetch(5000);
    const view = setup();
    await tick(1000);
    view.unmount();
    await tick(10000);
    expect((f.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("TC-20: useWakeIt outside a provider throws a clear error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within a WakeItProvider/);
  });
});

describe("WakeIt: accessibility", () => {
  it("TC-21: a polite live region is always present and announces warming, then ready", async () => {
    mockFetch(5000);
    setup();
    const region = liveRegion();
    expect(region).toBeTruthy();
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");

    await tick(1600);
    expect(liveRegion().textContent).toMatch(/Waking up server/);
    await tick(3600);
    expect(liveRegion().textContent).toMatch(/Server Warm & Ready/);
  });

  it("TC-22: a fast server produces no announcement", async () => {
    mockFetch(100);
    setup();
    await tick(500);
    expect(liveRegion().textContent).toBe("");
  });

  it("TC-23: buttons have accessible names, and dismiss hides the banner", async () => {
    mockFetch(50, 500);
    setup({ maxRetries: 0, showBannerOnError: true });
    await tick(200);

    const retry = screen.getByRole("button", { name: "Retry" });
    const dismiss = screen.getByRole("button", { name: "Dismiss server status" });
    expect(retry.getAttribute("type")).toBe("button");
    expect(dismiss.getAttribute("type")).toBe("button");
    expect(liveRegion().textContent).toMatch(/Server connection delayed/);

    fireEvent.click(dismiss);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("TC-24: the Retry button starts a new probe that can recover", async () => {
    let healthy = false;
    const f = vi.fn(async () => ({ ok: healthy, status: healthy ? 200 : 500 }) as Response);
    vi.stubGlobal("fetch", f);
    setup({ maxRetries: 0, showBannerOnError: true });
    await tick(100);
    expect(probeText()).toContain("error");

    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await tick(100);
    expect(f).toHaveBeenCalledTimes(2);
    expect(probeText()).toContain("ready|true");
  });

  it("TC-25: the banner is styled inline and needs no CSS framework", async () => {
    mockFetch(5000);
    setup({ position: "top-left" });
    await tick(1600);
    const banner = document.querySelector("[data-wakeit-banner]") as HTMLElement;
    expect(banner.style.position).toBe("fixed");
    expect(banner.style.top).toBe("20px");
    expect(banner.style.left).toBe("20px");
    expect(banner.getAttribute("class")).toBeNull();
    banner.querySelectorAll("svg").forEach((svg) => {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("TC-26: axe-core finds no violations in the warming, ready and error states", async () => {
    vi.useRealTimers();
    const check = async () => {
      const results = await axe.run(document.body, {
        // WCAG 2.x level A and AA rules. jsdom has no layout engine, so colour
        // contrast cannot be computed here; it is checked in a real browser
        // by bench/a11y-check.mjs.
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        rules: { "color-contrast": { enabled: false } },
      });
      return results.violations.map((v) => v.id);
    };

    // warming
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const warming = setup({ showBannerDelayMs: 10 });
    await waitFor(() => expect(bannerShows(/Waking up server/)).toBe(true));
    expect(await check()).toEqual([]);
    warming.unmount();

    // ready
    mockFetch(60);
    const ready = setup({ showBannerDelayMs: 10, autoHideMs: 0 });
    await waitFor(() => expect(bannerShows(/Server Warm & Ready/)).toBe(true));
    expect(await check()).toEqual([]);
    ready.unmount();
    localStorage.clear();

    // error
    mockFetch(5, 500);
    setup({ maxRetries: 0, showBannerOnError: true });
    await waitFor(() => expect(bannerShows(/Server connection delayed/)).toBe(true));
    expect(await check()).toEqual([]);
  });
});

describe("WakeIt: instrumentation and logging", () => {
  it("TC-27: onEvent reports the probe lifecycle in order with rising timestamps", async () => {
    const events: WakeItEvent[] = [];
    mockFetch(3000);
    setup({ onEvent: (e) => events.push(e) });
    await tick(3200);

    const types = events.map((e) => (e.type === "status_change" ? `status:${e.status}` : e.type));
    expect(types).toEqual([
      "status:checking",
      "probe_start",
      "status:warming",
      "first_byte",
      "status:ready",
      "ready",
    ]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }
    expect(events.every((e) => e.endpoint === URL)).toBe(true);
    expect(events.find((e) => e.type === "first_byte")?.httpStatus).toBe(200);
    expect(events.find((e) => e.type === "ready")?.elapsedMs).toBeGreaterThanOrEqual(3000);
  });

  it("TC-28: a listener that throws does not break the probe", async () => {
    mockFetch(100);
    setup({
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    await tick(300);
    expect(probeText()).toContain("ready|true");
  });

  it("TC-29: nothing is logged unless debug is on", async () => {
    mockFetch(100);
    const quiet = setup();
    await tick(300);
    expect(logSpy).not.toHaveBeenCalled();
    quiet.unmount();
    localStorage.clear();

    setup({ debug: true });
    await tick(300);
    expect(logSpy).toHaveBeenCalled();
  });
});

describe("prewarm()", () => {
  it("TC-30: overlapping calls share one request and store the warm state", async () => {
    const f = mockFetch(2000);
    const first = prewarm(URL);
    const second = prewarm(URL);
    expect(f).toHaveBeenCalledTimes(1);
    await tick(2100);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(a.status).toBe(200);
    expect(a.elapsedMs).toBeGreaterThanOrEqual(2000);
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();

    // a provider mounted afterwards starts in the ready state
    setup({ verifyCachedState: false });
    expect(probeText()).toContain("ready|true");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("TC-31: a failed or timed-out prewarm reports ok=false and stores nothing", async () => {
    mockFetch(50, 503);
    const failed = prewarm(URL);
    await tick(100);
    expect(await failed).toMatchObject({ ok: false, status: 503 });
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();

    mockFetch(60000);
    const slow = prewarm(URL, { timeoutMs: 1000 });
    await tick(1100);
    expect(await slow).toMatchObject({ ok: false, status: null });
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});
