// Demo page for experiment E3 (WakeIt off vs on).
//
// URL parameters:
//   api      base URL of the backend, e.g. https://xyz.onrender.com
//   mode     "off" (no WakeIt) or "on" (WakeIt enabled)
//   pattern  "lazy"  = the page sends nothing until the user acts (default)
//            "eager" = the page loads the item list as soon as it opens
//
// Every timestamp is performance.now(), i.e. ms since the page started loading.
// They are collected in window.__e3 and read by bench/e3-wakeit.mjs.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WakeItProvider, WakeItBanner, useWakeIt, type WakeItEvent } from "../../../src";

const params = new URLSearchParams(location.search);
const API = (params.get("api") ?? "http://127.0.0.1:4000/a").replace(/\/$/, "");
const MODE = params.get("mode") === "on" ? "on" : "off";
const PATTERN = params.get("pattern") === "eager" ? "eager" : "lazy";
// a11y=1 keeps every banner state on screen so bench/a11y-check.mjs can inspect it.
const A11Y = params.get("a11y") === "1";

type Marks = Record<string, number | string | null>;
const store = { mode: MODE, pattern: PATTERN, api: API, marks: {} as Marks, events: [] as WakeItEvent[] };
(window as unknown as { __e3: typeof store }).__e3 = store;
const mark = (name: string, value: number | string | null = performance.now()) => {
  if (store.marks[name] === undefined) store.marks[name] = value;
};

function Form({ ready, hint }: { ready: boolean; hint: string }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [list, setList] = useState<string>(PATTERN === "eager" ? "Loading items..." : "");

  useEffect(() => {
    mark("mounted");
    if (PATTERN !== "eager") return;
    fetch(`${API}/api/items`)
      .then((r) => r.json())
      .then((d) => {
        mark("list_visible");
        setList(`${d.items.length} item(s) loaded`);
      })
      .catch(() => setList("Could not load items"));
  }, []);

  async function add() {
    mark("click");
    setState("saving");
    try {
      const res = await fetch(`${API}/api/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "experiment item" }),
      });
      mark("action_status", String(res.status));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      mark("boot_id", data.bootId ?? null);
      mark("done");
      setState("done");
    } catch {
      mark("failed");
      setState("error");
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "48px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22 }}>To-do (WakeIt {MODE})</h1>
      <p id="hint" style={{ color: "#52525b", minHeight: 20 }}>{hint}</p>
      <button id="add" type="button" onClick={add} disabled={!ready || state === "saving"} style={{ padding: "10px 16px", fontSize: 15 }}>
        Add item
      </button>
      <p id="state" data-state={state}>
        {state === "saving" && "Saving..."}
        {state === "done" && "Saved."}
        {state === "error" && "Something went wrong."}
      </p>
      <p id="list">{list}</p>
    </main>
  );
}

function WithWakeIt() {
  const { isReady, isWarming } = useWakeIt();
  return <Form ready={isReady} hint={isWarming ? "The server is waking up. You can add items in a moment." : isReady ? "" : "Checking the server..."} />;
}

function App() {
  if (MODE === "off") return <Form ready hint="" />;
  return (
    <WakeItProvider
      healthEndpoint={`${API}/api/health`}
      config={{
        ...(A11Y ? { showBannerOnError: true, maxRetries: 0, autoHideMs: 0 } : {}),
        onEvent: (e) => {
          store.events.push(e);
          if (e.type === "probe_start") mark("probe_start", e.t);
          if (e.type === "status_change" && e.status === "warming") mark("warming_shown", e.t);
          if (e.type === "ready") mark("wakeit_ready", e.t);
        },
      }}
    >
      <WithWakeIt />
      <WakeItBanner />
    </WakeItProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
