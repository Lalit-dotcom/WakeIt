import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { WakeItProvider, WakeItBanner, useWakeIt } from "wakeit";
import "./compare.css";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const CACHE_KEY = "wakeit_backend_warmup_ts";

type ServerInfo = { bootMs: number; idleMs: number; bootMode: string };
type Phase = "idle" | "waiting" | "done" | "error";

const sec = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`);

/** Click -> data timing, shared by both panels. */
function useLoadData(url: string, startedAt: number) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clickToDataMs, setClickToDataMs] = useState<number | null>(null);
  const [dataAtMs, setDataAtMs] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function load() {
    const t0 = performance.now();
    setPhase("waiting");
    setClickToDataMs(null);
    setDataAtMs(null);
    timer.current = setInterval(() => setElapsedMs(performance.now() - t0), 100);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      await res.json();
      setClickToDataMs(performance.now() - t0);
      setDataAtMs(performance.now() - startedAt); // since page load
      setPhase("done");
    } catch {
      setPhase("error");
    } finally {
      if (timer.current) clearInterval(timer.current);
    }
  }
  return { phase, elapsedMs, clickToDataMs, dataAtMs, load };
}

function Row({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="flex justify-between border-b border-zinc-200 py-1.5 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-mono font-semibold ${hot ? "text-red-600" : "text-zinc-900"}`}>{value}</span>
    </div>
  );
}

function Card({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <section className="flex-1 rounded-xl border border-zinc-300 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{tag}</p>
      <h2 className="mb-4 text-lg font-bold text-zinc-900">{title}</h2>
      {children}
    </section>
  );
}

/** Plain fetch on click: no probe, no feedback. */
function WithoutPanel({ startedAt }: { startedAt: number }) {
  const { phase, elapsedMs, clickToDataMs, dataAtMs, load } = useLoadData(`${API}/a/api/data`, startedAt);
  return (
    <Card tag="Server A" title="Without WakeIt">
      <button
        onClick={load}
        disabled={phase === "waiting"}
        className="mb-4 w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white"
      >
        Load data
      </button>
      <Row label="Feedback shown to user" value={phase === "idle" ? "-" : "none"} hot={phase !== "idle"} />
      <Row label="Waiting after click" value={phase === "waiting" ? sec(elapsedMs) : sec(clickToDataMs)} hot />
      <Row label="Data shown at (since page load)" value={sec(dataAtMs)} hot />
      <p className="mt-3 text-xs text-zinc-500">
        {phase === "waiting" && "Button looks frozen. The user has no idea what is happening."}
        {phase === "done" && "Data arrived, but only after the full cold start."}
        {phase === "error" && "Request failed."}
      </p>
    </Card>
  );
}

/** Probe starts on mount; button is enabled only when the server is ready. */
function WithInner({ startedAt }: { startedAt: number }) {
  const { status, isReady, isWarming } = useWakeIt();
  const [feedbackMs, setFeedbackMs] = useState<number | null>(null);
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const { phase, clickToDataMs, dataAtMs, load } = useLoadData(`${API}/b/api/data`, startedAt);

  useEffect(() => {
    if (status === "warming" && feedbackMs === null) setFeedbackMs(performance.now() - startedAt);
    if (status === "ready" && readyMs === null) setReadyMs(performance.now() - startedAt);
  }, [status, feedbackMs, readyMs, startedAt]);

  return (
    <>
      <button
        onClick={load}
        disabled={!isReady || phase === "waiting"}
        className="mb-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-zinc-300 disabled:text-zinc-500"
      >
        {isReady ? "Load data" : isWarming ? "Server waking up..." : "Checking server..."}
      </button>
      <Row label="First feedback shown after" value={sec(feedbackMs)} />
      <Row label="Server ready after page load" value={sec(readyMs)} />
      <Row label="Waiting after click" value={sec(clickToDataMs)} />
      <Row label="Data shown at (since page load)" value={sec(dataAtMs)} />
      <p className="mt-3 text-xs text-zinc-500">
        {!isReady && "Probe was sent as soon as the page loaded. The badge (bottom-right) keeps the user informed."}
        {isReady && phase !== "done" && "Server is warm. Click is instant."}
        {phase === "done" && "Data arrived instantly because the server was already awake."}
      </p>
    </>
  );
}

function App() {
  const [run, setRun] = useState(0);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [sinceStart, setSinceStart] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    fetch(`${API}/__state`).then((r) => r.json()).then(setInfo).catch(() => setServerDown(true));
  }, []);

  useEffect(() => {
    if (run === 0) return;
    const id = setInterval(() => setSinceStart(performance.now() - startedAt), 200);
    return () => clearInterval(id);
  }, [run, startedAt]);

  async function start() {
    try {
      await fetch(`${API}/__sleep`); // both servers go back to sleep
      localStorage.removeItem(CACHE_KEY); // forget the warm-state cache
      setStartedAt(performance.now());
      setSinceStart(0);
      setRun((r) => r + 1); // remount both panels: WakeIt probe starts now
    } catch {
      setServerDown(true);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-zinc-50 p-6 font-sans">
      <h1 className="text-2xl font-bold text-zinc-900">WakeIt: cold start, with vs without</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Two identical sleeping servers. Press Start (both go to sleep and the page "loads"), wait a few
        seconds like a real user reading the page, then press Load data on each side.
      </p>

      {serverDown && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Simulator not reachable at {API}. Run <code>npm start</code> inside <code>example/server</code>.
        </p>
      )}

      <div className="my-5 flex items-center gap-4">
        <button onClick={start} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white">
          {run === 0 ? "Start experiment" : "Restart experiment"}
        </button>
        {info && (
          <span className="text-xs text-zinc-500">
            Simulated cold start: {info.bootMs / 1000} s, mode: {info.bootMode === "503" ? "503 while booting" : "request held"}
          </span>
        )}
        {sinceStart !== null && (
          <span className="ml-auto font-mono text-sm text-zinc-700">Time since page load: {sec(sinceStart)}</span>
        )}
      </div>

      {run === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          Press "Start experiment" to begin.
        </p>
      ) : (
        <div className="flex flex-col gap-5 md:flex-row" key={run}>
          <WithoutPanel startedAt={startedAt} />
          <Card tag="Server B" title="With WakeIt">
            <WakeItProvider
              healthEndpoint={`${API}/b/api/health`}
              config={{ retryIntervalMs: 2000, position: "bottom-right" }}
            >
              <WithInner startedAt={startedAt} />
              <WakeItBanner />
            </WakeItProvider>
          </Card>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-500">
        Note: WakeIt does not make the server boot faster. It starts the boot at page load, overlaps it with the
        time the user spends on the page, and tells the user what is happening instead of a frozen button.
      </p>
    </main>
  );
}

createRoot(document.getElementById("compare-root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
