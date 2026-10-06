import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { WakeItProvider, WakeItBanner, useWakeIt } from "../src";

const CACHE_KEY = "wakeit_backend_warmup_ts";
const URL = "/api/health";

/** fetch mock: responds after `delayMs` with given status */
function mockFetch(delayMs: number, status = 200) {
  const fn = vi.fn(
    () =>
      new Promise<Response>((resolve) =>
        setTimeout(() => resolve({ ok: status < 400, status } as Response), delayMs),
      ),
  );
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

function setup(config = {}) {
  return render(
    <WakeItProvider healthEndpoint={URL} config={config}>
      <Probe />
      <WakeItBanner />
    </WakeItProvider>,
  );
}

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WakeIt", () => {
  it("TC-01: fast server (<1.5s) stays silent and saves warm cache", async () => {
    const f = mockFetch(100);
    setup();
    await tick(200);

    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("probe").textContent).toContain("ready|true");
    expect(screen.queryByText(/Waking up server/)).toBeNull();
    expect(screen.queryByText(/Server Warm & Ready/)).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });

  it("TC-02: slow server (>1.5s) shows warming badge, then ready toast that auto-hides", async () => {
    mockFetch(5000);
    setup();

    await tick(1600);
    expect(screen.getByText(/Waking up server/)).toBeTruthy();
    expect(screen.getByTestId("probe").textContent).toContain("warming|false|true");

    await tick(3600); // server answers at 5000ms total
    expect(screen.getByText(/Server Warm & Ready/)).toBeTruthy();

    await tick(4100); // autoHideMs = 4000
    expect(screen.queryByText(/Server Warm & Ready/)).toBeNull();
  });

  it("TC-03: valid cache skips the network probe entirely", async () => {
    localStorage.setItem(CACHE_KEY, Date.now().toString());
    const f = mockFetch(100);
    setup();
    await tick(200);

    expect(f).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe").textContent).toContain("ready|true");
  });

  it("TC-04: expired cache triggers a fresh probe", async () => {
    const old = Date.now() - 15 * 60 * 1000; // older than 14 min TTL
    localStorage.setItem(CACHE_KEY, old.toString());
    const f = mockFetch(100);
    setup();
    await tick(200);

    expect(f).toHaveBeenCalledTimes(1);
    expect(Number(localStorage.getItem(CACHE_KEY))).toBeGreaterThan(old);
  });

  it("TC-05: failing backend retries maxRetries times, then ends in error with retry button", async () => {
    const f = mockFetch(50, 500);
    setup({ maxRetries: 2, retryIntervalMs: 1000, showBannerOnError: true });
    await tick(5000);

    expect(f).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(screen.getByTestId("probe").textContent).toContain("error");
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe("WakeIt retry logic (booting platforms)", () => {
  /** fetch mock: answers `bootStatus` until `bootMs` after first call, then 200 */
  function mockBooting(bootMs: number, bootStatus = 503) {
    const t0 = Date.now();
    const fn = vi.fn(async () => {
      const up = Date.now() - t0 >= bootMs;
      return { ok: up, status: up ? 200 : bootStatus } as Response;
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("TC-06: fast 503s while booting do not exhaust maxRetries; ends ready with toast", async () => {
    const f = mockBooting(40000);
    setup();

    await tick(10000);
    expect(screen.getByTestId("probe").textContent).toContain("warming"); // never flips to error
    expect(screen.getByText(/Waking up server/)).toBeTruthy();

    await tick(32000); // total 42s; server is up at 40s, toast still visible (autoHide 4s)
    expect(screen.getByTestId("probe").textContent).toContain("ready|true");
    expect(screen.getByText(/Server Warm & Ready/)).toBeTruthy();
    expect(f.mock.calls.length).toBeGreaterThan(4); // more than 1 + maxRetries(3)
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });

  it("TC-07: gives up with error after bootWindowMs if server never comes up", async () => {
    const f = mockBooting(10 * 60 * 1000);
    setup({ bootWindowMs: 20000, retryIntervalMs: 5000, showBannerOnError: true });
    await tick(60000);

    expect(screen.getByTestId("probe").textContent).toContain("error");
    expect(screen.getByText("Retry")).toBeTruthy();
    const calls = f.mock.calls.length;
    await tick(60000); // no further auto-retries once given up
    expect(f.mock.calls.length).toBe(calls);
  });

  it("TC-08: 404 (real failure, not booting) still follows maxRetries", async () => {
    const f = mockFetch(50, 404);
    setup({ maxRetries: 2, retryIntervalMs: 1000 });
    await tick(10000);
    expect(f).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("probe").textContent).toContain("error");
  });
});
