// Cold-start simulator: behaves like a free-tier PaaS (Render / Railway / Heroku).
//  - after IDLE_MS without traffic the "container" goes to sleep
//  - the next request triggers a cold start that takes BOOT_MS
//  - BOOT_MODE=hold -> requests wait until boot finishes (Render style)
//  - BOOT_MODE=503  -> requests get 503 until boot finishes (Railway/Heroku style)
//
// Two independent "deployments" (/a and /b) so the A/B demo does not cross-warm.
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 4000);
const IDLE_MS = Number(process.env.IDLE_MS ?? 60_000);
const BOOT_MS = Number(process.env.BOOT_MS ?? 25_000);
const BOOT_MODE = process.env.BOOT_MODE === "503" ? "503" : "hold";

const apps = new Map();
function getApp(name) {
  if (!apps.has(name))
    apps.set(name, { awake: false, bootingUntil: 0, lastActivity: 0, bootId: null, awakeAt: 0 });
  return apps.get(name);
}
const log = (name, msg) =>
  console.log(`[${new Date().toLocaleTimeString()}] app "${name}": ${msg}`);

/** Updates the sleep/boot state machine; returns ms until the app is awake (0 = awake). */
function remaining(name) {
  const s = getApp(name);
  const now = Date.now();
  // 1. A boot that was started earlier may have finished in the meantime.
  if (s.bootingUntil && now >= s.bootingUntil) {
    s.awake = true;
    s.awakeAt = s.bootingUntil;
    s.lastActivity = s.bootingUntil; // idle time counts from the moment the boot finished
    s.bootingUntil = 0;
    s.bootId = randomUUID(); // a new "process" for every simulated cold start
    log(name, "is awake");
  }
  // 2. An awake app with no traffic for IDLE_MS goes back to sleep.
  if (s.awake && now - s.lastActivity > IDLE_MS) {
    s.awake = false;
    log(name, "went to sleep (idle)");
  }
  // 3. A request to a sleeping app starts a cold start.
  if (!s.awake && !s.bootingUntil) {
    s.bootingUntil = now + BOOT_MS;
    log(name, `COLD START begins (${BOOT_MS}ms, mode=${BOOT_MODE})`);
  }
  return s.awake ? 0 : s.bootingUntil - now;
}

const server = express();
server.use(cors());
server.use(express.json());

// ---- control routes (never delayed) ----
server.get("/__sleep", (_req, res) => {
  for (const name of ["a", "b"]) {
    Object.assign(getApp(name), { awake: false, bootingUntil: 0 });
    log(name, "forced to sleep");
  }
  res.json({ ok: true });
});
server.get("/__state", (_req, res) => {
  res.json({ bootMs: BOOT_MS, idleMs: IDLE_MS, bootMode: BOOT_MODE });
});

// ---- cold-start gate for every /:app/api/* route ----
server.use("/:app/api", (req, res, next) => {
  const name = req.params.app;
  const wait = remaining(name);
  if (wait <= 0) {
    getApp(name).lastActivity = Date.now();
    return next();
  }
  if (BOOT_MODE === "503") {
    return res.status(503).json({ error: "server is booting", retryInMs: wait });
  }
  // hold the request open until boot completes (like Render's proxy)
  const timer = setTimeout(() => {
    remaining(name);
    getApp(name).lastActivity = Date.now();
    next();
  }, wait);
  // Stop waiting only if the client really went away. (The request's own
  // "close" event also fires once a POST body has been read, so use the response.)
  res.on("close", () => {
    if (!res.writableEnded) clearTimeout(timer);
  });
});

server.get("/:app/api/health", (req, res) =>
  res.json({ status: "ok", bootId: getApp(req.params.app).bootId }),
);
// Same shape as bench/reference-app, so the measurement tools can be tested here.
server.get("/:app/api/boot-info", (req, res) => {
  const s = getApp(req.params.app);
  res.json({
    status: "ok",
    bootId: s.bootId,
    processStartEpochMs: s.awakeAt - BOOT_MS,
    uptimeMs: Date.now() - s.awakeAt + BOOT_MS,
    phases: { nodeBootMs: 0, importsDoneMs: 0, dbConnectedMs: null, listeningMs: BOOT_MS, firstRequestMs: BOOT_MS },
    database: "off",
    simulated: true,
  });
});
const items = [];
server.get("/:app/api/items", (_req, res) => res.json({ items }));
server.post("/:app/api/items", (req, res) => {
  const item = { id: items.length + 1, text: String(req.body?.text ?? "") };
  items.push(item);
  res.status(201).json({ item, bootId: getApp(req.params.app).bootId });
});
server.get("/:app/api/data", (_req, res) => {
  res.json({
    servedAt: new Date().toISOString(),
    items: ["Invoice #1042", "Invoice #1043", "Invoice #1044"],
  });
});

server.listen(PORT, () => {
  console.log(`Cold-start simulator on http://localhost:${PORT}`);
  console.log(`  idle sleep after ${IDLE_MS}ms, cold start ${BOOT_MS}ms, mode=${BOOT_MODE}`);
});
