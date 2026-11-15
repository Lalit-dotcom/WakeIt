#!/usr/bin/env node
// E1/E2: cold-start measurement harness.
//
// For every target in the targets file, and for every cycle:
//   1. wait the idle period (no traffic is sent to the target),
//   2. send one request and time it (the cold request),
//   3. read /api/boot-info to prove a new process started and get its boot phases,
//   4. send three more requests to measure the normal (warm) response time.
// One CSV row is appended per cycle. All targets run at the same time.
//
// Needs only Node.js 20 or newer. No packages to install.
//
// Usage:
//   node bench/coldstart.mjs --targets bench/targets.json --session night1 --total 10 --vantage india-laptop
//
// Options:
//   --targets <file>   JSON list of targets (see bench/targets.example.json)
//   --out <file>       CSV file to append to (default: bench/results/coldstart.csv)
//   --session <name>   label for this batch, e.g. night1 or day1 (default: s1)
//   --total <n>        stop when each target has n rows for this session (default: 10)
//   --vantage <name>   where the script runs, e.g. india-laptop (default: unknown)
//   --only <name>      run a single target
//   --dry-run          print the plan and exit

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

export const TOOL_VERSION = "coldstart-1.0.0";
const USER_AGENT = "wakeit-bench/1.0 (cold-start measurement; research)";

const COLD_DEADLINE_MS = 240_000; // give up on one cold start after 4 minutes
const REQUEST_TIMEOUT_MS = 180_000; // one request may be held this long
const RETRY_PAUSE_MS = 500; // pause between attempts while the platform answers "booting"
const WARM_SAMPLES = 3;
const WARM_PAUSE_MS = 500;

export const COLUMNS = [
  "tool_version", "run_id", "session", "vantage", "target", "platform", "region",
  "cycle", "utc_start", "local_hour", "idle_wait_s",
  "cold_ok", "cold_total_ms", "attempts", "status_sequence",
  "first_status", "first_dns_ms", "first_tcp_ms", "first_tls_ms", "first_ttfb_ms", "first_total_ms",
  "first_content_type", "first_body_sha256", "first_body_snippet", "first_headers",
  "boot_id", "prev_boot_id", "cold_evidence", "uptime_ms_at_probe",
  "app_node_boot_ms", "app_imports_done_ms", "app_db_connected_ms", "app_listening_ms", "app_first_request_ms",
  "warm1_ms", "warm2_ms", "warm3_ms", "warm_median_ms",
  "platform_overhead_ms", "error",
];

// ---------- small helpers ----------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (ms) => (ms === null || ms === undefined ? "" : Math.round(ms * 10) / 10);
const stamp = () => new Date().toISOString().slice(11, 19);

export function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

export function appendRow(file, columns, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, columns.join(",") + "\n");
  fs.appendFileSync(file, columns.map((c) => csvCell(record[c])).join(",") + "\n");
}

function median(values) {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * One GET request on a NEW connection, with phase timings in ms from the start
 * of the request: DNS lookup done, TCP connected, TLS ready, first byte, done.
 */
export function timedGet(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const timing = { dns: null, tcp: null, tls: null, ttfb: null, total: null };
    const lib = url.startsWith("https:") ? https : http;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      timing.total = performance.now() - t0;
      resolve({ timing, ...result });
    };

    const req = lib.get(
      url,
      {
        agent: false, // never reuse a connection: every sample pays the full handshake
        headers: { Accept: "application/json", "User-Agent": USER_AGENT, "Cache-Control": "no-cache" },
      },
      (res) => {
        timing.ttfb = performance.now() - t0;
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          if (size < 65536) chunks.push(c);
          size += c.length;
        });
        res.on("end", () =>
          finish({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", (err) => finish({ status: res.statusCode, headers: res.headers, body: "", error: err.code ?? err.message }));
      },
    );
    req.on("socket", (socket) => {
      socket.on("lookup", () => { timing.dns = performance.now() - t0; });
      socket.on("connect", () => { timing.tcp = performance.now() - t0; });
      socket.on("secureConnect", () => { timing.tls = performance.now() - t0; });
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    req.on("error", (err) => finish({ status: null, headers: {}, body: "", error: err.code ?? err.message }));
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** Keeps only headers that say something about the platform or the boot. */
function interestingHeaders(headers) {
  const keep = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (
      ["server", "via", "retry-after", "content-type", "x-powered-by"].includes(name) ||
      /^(x-render|rndr|fly-|x-fly|x-railway|x-koyeb|koyeb|x-vercel|cf-ray|x-served-by|x-request-start)/.test(name)
    ) keep[name] = String(value).slice(0, 120);
  }
  return JSON.stringify(keep);
}

// ---------- one measurement cycle ----------

export async function measureOnce(target, prevBootId) {
  const healthUrl = target.baseUrl.replace(/\/$/, "") + (target.healthPath ?? "/api/health");
  const bootInfoUrl = target.baseUrl.replace(/\/$/, "") + (target.bootInfoPath ?? "/api/boot-info");
  const rec = { utc_start: new Date().toISOString(), local_hour: new Date().getHours(), prev_boot_id: prevBootId ?? "" };

  // --- cold request: repeat until the app itself answers, or the deadline passes ---
  const coldStart = performance.now();
  const statuses = [];
  let first = null;
  let ok = false;
  while (performance.now() - coldStart < COLD_DEADLINE_MS) {
    const res = await timedGet(healthUrl);
    if (!first) first = res;
    statuses.push(res.status ?? res.error ?? "ERR");
    const json = parseJson(res.body);
    if (res.status === 200 && json && json.status === "ok") { ok = true; break; }
    await sleep(RETRY_PAUSE_MS);
  }
  const coldTotal = performance.now() - coldStart;

  rec.cold_ok = ok ? 1 : 0;
  rec.cold_total_ms = ok ? round(coldTotal) : "";
  rec.attempts = statuses.length;
  rec.status_sequence = statuses.join(" ");
  rec.first_status = first.status ?? "";
  rec.first_dns_ms = round(first.timing.dns);
  rec.first_tcp_ms = round(first.timing.tcp);
  rec.first_tls_ms = round(first.timing.tls);
  rec.first_ttfb_ms = round(first.timing.ttfb);
  rec.first_total_ms = round(first.timing.total);
  rec.first_content_type = first.headers?.["content-type"] ?? "";
  rec.first_headers = interestingHeaders(first.headers);
  const firstJson = parseJson(first.body);
  if (!(first.status === 200 && firstJson?.status === "ok") && first.body) {
    // Not the app's own answer (e.g. a platform loading page or a 502 body): keep a fingerprint.
    rec.first_body_sha256 = createHash("sha256").update(first.body).digest("hex").slice(0, 16);
    rec.first_body_snippet = first.body.replace(/\s+/g, " ").slice(0, 200);
  }
  if (!ok) {
    rec.error = `no healthy answer within ${COLD_DEADLINE_MS / 1000}s (${first.error ?? "last status " + statuses.at(-1)})`;
    return rec;
  }

  // --- boot info: was this a new process, and how long did the app itself take? ---
  const info = parseJson((await timedGet(bootInfoUrl, 30_000)).body);
  if (info?.bootId) {
    rec.boot_id = info.bootId;
    rec.uptime_ms_at_probe = round(info.uptimeMs);
    rec.app_node_boot_ms = round(info.phases?.nodeBootMs);
    rec.app_imports_done_ms = round(info.phases?.importsDoneMs);
    rec.app_db_connected_ms = round(info.phases?.dbConnectedMs);
    rec.app_listening_ms = round(info.phases?.listeningMs);
    rec.app_first_request_ms = round(info.phases?.firstRequestMs);
    if (prevBootId && info.bootId !== prevBootId) rec.cold_evidence = "boot_id_changed";
    else if (!prevBootId && typeof info.uptimeMs === "number" && info.uptimeMs < coldTotal + 10_000) rec.cold_evidence = "uptime";
    else rec.cold_evidence = "none";
  } else {
    rec.cold_evidence = "no_boot_info";
  }

  // --- warm samples: the same request when the server is already awake ---
  const warm = [];
  for (let i = 0; i < WARM_SAMPLES; i++) {
    await sleep(WARM_PAUSE_MS);
    const res = await timedGet(healthUrl, 30_000);
    warm.push(res.status === 200 ? res.timing.total : null);
  }
  [rec.warm1_ms, rec.warm2_ms, rec.warm3_ms] = warm.map(round);
  const warmMedian = median(warm);
  rec.warm_median_ms = round(warmMedian);

  // --- decomposition: what is left after network time and the app's own start-up ---
  const listening = info?.phases?.listeningMs;
  if (warmMedian !== null && typeof listening === "number") {
    rec.platform_overhead_ms = round(coldTotal - warmMedian - listening);
  }
  return rec;
}

// ---------- main loop ----------

async function runTarget(target, opts) {
  const key = (r) => r.target === target.name && r.session === opts.session;
  const existing = fs.existsSync(opts.out) ? parseCsv(fs.readFileSync(opts.out, "utf8")) : [];
  let done = existing.filter(key).length;
  let prevBootId = existing.filter((r) => r.target === target.name && r.boot_id).at(-1)?.boot_id ?? null;
  const idleMs = Math.round(target.idleWaitMinutes * 60_000);

  if (done >= opts.total) {
    console.log(`[${stamp()}] ${target.name}: already has ${done}/${opts.total} rows for session "${opts.session}". Nothing to do.`);
    return;
  }
  console.log(`[${stamp()}] ${target.name}: ${done}/${opts.total} done, idle wait ${target.idleWaitMinutes} min per cycle.`);

  while (done < opts.total) {
    const wakeAt = new Date(Date.now() + idleMs);
    console.log(`[${stamp()}] ${target.name}: cycle ${done + 1}/${opts.total}, idling until ${wakeAt.toTimeString().slice(0, 8)}`);
    await sleep(idleMs);

    let rec;
    try {
      rec = await measureOnce(target, prevBootId);
    } catch (err) {
      rec = { utc_start: new Date().toISOString(), cold_ok: 0, error: String(err?.message ?? err) };
    }
    Object.assign(rec, {
      tool_version: TOOL_VERSION, run_id: opts.runId, session: opts.session, vantage: opts.vantage,
      target: target.name, platform: target.platform, region: target.region ?? "",
      cycle: done + 1, idle_wait_s: Math.round(idleMs / 1000),
    });
    appendRow(opts.out, COLUMNS, rec);
    if (rec.boot_id) prevBootId = rec.boot_id;
    done++;
    console.log(
      rec.cold_ok
        ? `[${stamp()}] ${target.name}: cold ${rec.cold_total_ms} ms, warm ${rec.warm_median_ms} ms, statuses [${rec.status_sequence}], evidence ${rec.cold_evidence}`
        : `[${stamp()}] ${target.name}: FAILED: ${rec.error}`,
    );
  }
  console.log(`[${stamp()}] ${target.name}: finished.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.targets) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 24).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(args.help ? 0 : 1);
  }
  let targets = JSON.parse(fs.readFileSync(args.targets, "utf8"));
  if (args.only) targets = targets.filter((t) => t.name === args.only);
  for (const t of targets) {
    for (const field of ["name", "platform", "baseUrl", "idleWaitMinutes"]) {
      if (t[field] === undefined) throw new Error(`Target ${JSON.stringify(t)} is missing "${field}"`);
    }
  }
  if (!targets.length) throw new Error("No targets to run.");

  const opts = {
    out: args.out ?? "bench/results/coldstart.csv",
    session: String(args.session ?? "s1"),
    total: Number(args.total ?? 10),
    vantage: String(args.vantage ?? "unknown"),
    runId: randomUUID().slice(0, 8),
  };
  const longest = Math.max(...targets.map((t) => t.idleWaitMinutes));
  console.log(`Run ${opts.runId}: ${targets.length} target(s), session "${opts.session}", ${opts.total} cycles each, vantage "${opts.vantage}".`);
  console.log(`Results: ${opts.out}`);
  console.log(`Longest target needs about ${Math.round((opts.total * (longest + 1.5)) / 6) / 10} hours. Keep this computer awake and do not open the target sites.`);
  if (args["dry-run"]) return;

  await Promise.all(targets.map((t) => runTarget(t, opts)));
  console.log("All targets finished.");
}

// Run only when started directly (not when imported by another script).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
