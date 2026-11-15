#!/usr/bin/env node
// E3: WakeIt off vs on, driven by a real browser (Playwright + Chromium).
//
// Two identical backends (A and B) are left idle until both are asleep. Then two
// browser windows open the same demo page at the same moment: one without WakeIt
// and one with it. A scripted "user" waits a think-time, then clicks "Add item".
// The page records when things happened; one CSV row is written per window.
//
// Which backend gets WakeIt alternates every cycle, so a slower backend cannot
// favour one side. The order of think-times is shuffled with a recorded seed.
//
// Usage:
//   node bench/e3-wakeit.mjs --a https://ref-a.onrender.com --b https://ref-b.onrender.com --idle-min 20
//
// Options:
//   --a, --b <url>     base URLs of the two backends (required)
//   --idle-min <n>     minutes to leave both backends idle before each cycle (default: 20)
//   --think <list>     think-times in seconds (default: 0,5,10,20)
//   --reps <n>         repetitions of each think-time (default: 5)
//   --pattern <p>      lazy (default) or eager; see bench/e3-demo/src/main.tsx
//   --session <name>   label for this batch (default: e3)
//   --out <file>       CSV file (default: bench/results/e3.csv)
//   --vantage <name>   where the script runs (default: unknown)
//   --seed <n>         shuffle seed (default: random; reused automatically on resume)
//   --headed           show the browser windows

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { appendRow, parseCsv, timedGet } from "./coldstart.mjs";

const TOOL_VERSION = "e3-1.0.0";
const ACTION_TIMEOUT_MS = 240_000;
const here = path.dirname(fileURLToPath(import.meta.url));

const COLUMNS = [
  "tool_version", "run_id", "session", "seed", "vantage", "cycle", "mode", "backend", "backend_url", "pattern",
  "think_ms", "utc_start",
  "t_mounted_ms", "t_probe_start_ms", "t_warming_shown_ms", "t_wakeit_ready_ms",
  "t_intent_ms", "blocked_at_intent", "t_click_ms", "t_done_ms",
  "wait_after_intent_ms", "wait_after_click_ms", "action_status",
  "boot_id", "prev_boot_id", "cold_evidence", "app_listening_ms", "error",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[argv[i].slice(2)] = true;
    else args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const r1 = (x) => (typeof x === "number" ? Math.round(x * 10) / 10 : "");

/** Small seeded random generator, so a shuffle can be repeated exactly. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, seed) {
  const rand = mulberry32(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Serves bench/e3-demo/dist on a free local port. */
function serveDemo() {
  const root = path.join(here, "e3-demo", "dist");
  if (!fs.existsSync(path.join(root, "app.js"))) {
    throw new Error("Demo page not built. Run: node bench/build-demo.mjs");
  }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  const server = http.createServer((req, res) => {
    const name = req.url.split("?")[0] === "/" ? "index.html" : path.basename(req.url.split("?")[0]);
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function runWindow(browser, pageUrl, thinkMs) {
  const context = await browser.newContext(); // fresh storage: no warm cache from earlier cycles
  const page = await context.newPage();
  const out = {};
  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__e3?.marks?.mounted !== undefined, null, { timeout: 30_000 });
    // The scripted user "reads the page" until thinkMs after the page started loading.
    await page.waitForFunction((t) => performance.now() >= t, thinkMs, { timeout: thinkMs + 30_000 });
    out.t_intent_ms = await page.evaluate(() => performance.now());
    out.blocked_at_intent = (await page.locator("#add").isDisabled()) ? 1 : 0;
    // Wait for the button to be enabled, checking on every animation frame, so the
    // scripted user reacts within about one frame of the button becoming usable.
    await page.waitForFunction(() => !document.querySelector("#add").disabled, null, {
      timeout: ACTION_TIMEOUT_MS,
      polling: "raf",
    });
    await page.click("#add", { timeout: 10_000 });
    await page.waitForSelector('#state[data-state="done"], #state[data-state="error"]', { timeout: ACTION_TIMEOUT_MS });
  } catch (err) {
    out.error = String(err?.message ?? err).split("\n")[0].slice(0, 200);
  }
  try {
    out.marks = (await page.evaluate(() => window.__e3))?.marks ?? {};
  } catch {
    out.marks = {};
  }
  await context.close();
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.a || !args.b) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 28).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(args.help ? 0 : 1);
  }
  const backends = { a: String(args.a).replace(/\/$/, ""), b: String(args.b).replace(/\/$/, "") };
  const out = args.out ?? "bench/results/e3.csv";
  const session = String(args.session ?? "e3");
  const idleMs = Math.round(Number(args["idle-min"] ?? 20) * 60_000);
  const thinks = String(args.think ?? "0,5,10,20").split(",").map((s) => Math.round(Number(s) * 1000));
  const reps = Number(args.reps ?? 5);
  const pattern = args.pattern === "eager" ? "eager" : "lazy";
  const vantage = String(args.vantage ?? "unknown");
  const runId = randomUUID().slice(0, 8);

  const existing = (fs.existsSync(out) ? parseCsv(fs.readFileSync(out, "utf8")) : []).filter((r) => r.session === session);
  const seed = existing.length ? Number(existing[0].seed) : Number(args.seed ?? Math.floor(Math.random() * 1e9));
  const schedule = shuffled(thinks.flatMap((t) => Array(reps).fill(t)), seed);
  let cycle = new Set(existing.map((r) => r.cycle)).size;
  const prevBoot = { a: null, b: null };
  for (const r of existing) if (r.boot_id) prevBoot[r.backend] = r.boot_id;

  // Playwright is loaded here so that --help works without it.
  const { chromium } = createRequire(import.meta.url)("playwright");
  const server = await serveDemo();
  const base = `http://127.0.0.1:${server.address().port}/`;

  console.log(`Run ${runId}: session "${session}", ${schedule.length} cycles (${cycle} done), seed ${seed}, pattern ${pattern}.`);
  console.log(`About ${Math.round(((schedule.length - cycle) * (idleMs / 60000 + 2)) / 6) / 10} hours left. Keep this computer awake and do not open the backends.`);

  while (cycle < schedule.length) {
    const thinkMs = schedule[cycle];
    // Alternate which backend runs with WakeIt.
    const assignment = cycle % 2 === 0 ? { off: "a", on: "b" } : { off: "b", on: "a" };
    console.log(`[${stamp()}] cycle ${cycle + 1}/${schedule.length}: think ${thinkMs / 1000}s, off=${assignment.off} on=${assignment.on}; idling ${idleMs / 60000} min`);
    await sleep(idleMs);

    const utcStart = new Date().toISOString();
    const browser = await chromium.launch({ headless: !args.headed });
    const url = (mode) => `${base}?mode=${mode}&pattern=${pattern}&api=${encodeURIComponent(backends[assignment[mode]])}`;
    const [off, on] = await Promise.all([runWindow(browser, url("off"), thinkMs), runWindow(browser, url("on"), thinkMs)]);
    await browser.close();

    for (const [mode, result] of [["off", off], ["on", on]]) {
      const backend = assignment[mode];
      const m = result.marks;
      const bootRes = await timedGet(`${backends[backend]}/api/boot-info`, 30_000);
      let boot = null;
      try { boot = JSON.parse(bootRes.body); } catch { boot = null; }
      const done = typeof m.done === "number" ? m.done : null;
      // The boot ID returned with the action itself is the one that served the user.
      const bootId = typeof m.boot_id === "string" ? m.boot_id : (boot?.bootId ?? null);
      let evidence = "no_boot_info";
      if (bootId) {
        if (prevBoot[backend] && bootId !== prevBoot[backend]) evidence = "boot_id_changed";
        else if (!prevBoot[backend] && done !== null && boot?.bootId === bootId && boot.uptimeMs < done + 15_000) evidence = "uptime";
        else evidence = "none";
      }
      appendRow(out, COLUMNS, {
        tool_version: TOOL_VERSION, run_id: runId, session, seed, vantage, cycle: cycle + 1, mode, backend,
        backend_url: backends[backend], pattern, think_ms: thinkMs, utc_start: utcStart,
        t_mounted_ms: r1(m.mounted), t_probe_start_ms: r1(m.probe_start), t_warming_shown_ms: r1(m.warming_shown),
        t_wakeit_ready_ms: r1(m.wakeit_ready), t_intent_ms: r1(result.t_intent_ms), blocked_at_intent: result.blocked_at_intent ?? "",
        t_click_ms: r1(m.click), t_done_ms: r1(done),
        wait_after_intent_ms: done !== null && typeof result.t_intent_ms === "number" ? r1(done - result.t_intent_ms) : "",
        wait_after_click_ms: done !== null && typeof m.click === "number" ? r1(done - m.click) : "",
        action_status: m.action_status ?? "", boot_id: bootId ?? "", prev_boot_id: prevBoot[backend] ?? "",
        cold_evidence: evidence, app_listening_ms: r1(boot?.phases?.listeningMs),
        error: result.error ?? (m.failed !== undefined ? "action failed" : ""),
      });
      if (bootId) prevBoot[backend] = bootId;
      console.log(`[${stamp()}]   ${mode.padEnd(3)} on ${backend}: done at ${r1(done)} ms, waited ${done !== null ? r1(done - result.t_intent_ms) : "?"} ms after intent, ${evidence}${result.error ? ", ERROR " + result.error : ""}`);
    }
    cycle++;
  }
  server.close();
  console.log("E3 finished. Results:", out);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
