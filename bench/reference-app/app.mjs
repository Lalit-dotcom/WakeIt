// WakeIt reference backend.
//
// The same small app is deployed on every platform so that cold starts can be
// compared fairly. It measures its own start-up phases and reports them at
// GET /api/boot-info. It never calls itself and has no timers, so it does
// nothing to keep the platform from putting it to sleep.
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";

const boot = globalThis.__wakeitBoot ?? {
  entryMs: 0,
  processStartEpochMs: performance.timeOrigin,
};
const phases = {
  nodeBootMs: round(boot.entryMs), // process start -> first line of index.mjs
  importsDoneMs: round(performance.now()), // -> express and cors loaded
  dbConnectedMs: null, // -> database connection ready (only with DATABASE_URL)
  listeningMs: null, // -> HTTP server accepting connections
  firstRequestMs: null, // -> first request received
};

// A new random ID for every process. If it changes between two probes, the
// platform really started a new process, i.e. a cold start happened.
const bootId = randomUUID();

function round(ms) {
  return Math.round(ms * 10) / 10;
}

// ---- optional database connection (measures the "database connection" phase) ----
let db = null;
let dbError = null;
if (process.env.DATABASE_URL) {
  try {
    const { default: pg } = await import("pg");
    db = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "off" ? false : { rejectUnauthorized: false },
    });
    await db.connect();
    await db.query("select 1");
    phases.dbConnectedMs = round(performance.now());
  } catch (err) {
    dbError = String(err?.message ?? err);
    db = null;
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.use((_req, _res, next) => {
  if (phases.firstRequestMs === null) phases.firstRequestMs = round(performance.now());
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", bootId });
});

app.get("/api/boot-info", (_req, res) => {
  res.json({
    status: "ok",
    bootId,
    processStartEpochMs: Math.round(boot.processStartEpochMs),
    uptimeMs: round(performance.now()),
    phases,
    database: process.env.DATABASE_URL ? (db ? "connected" : `error: ${dbError}`) : "off",
    node: process.version,
    region: process.env.RENDER_REGION ?? process.env.FLY_REGION ?? process.env.KOYEB_REGION ?? process.env.RAILWAY_REPLICA_REGION ?? null,
  });
});

// A tiny in-memory list, used as the "user action" in the WakeIt experiment.
const items = [];
app.get("/api/items", (_req, res) => res.json({ items }));
app.post("/api/items", (req, res) => {
  const text = String(req.body?.text ?? "").slice(0, 200);
  if (!text) return res.status(400).json({ error: "text is required" });
  const item = { id: items.length + 1, text, createdAt: new Date().toISOString() };
  items.push(item);
  if (items.length > 500) items.shift();
  res.status(201).json({ item, bootId });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, "0.0.0.0", () => {
  phases.listeningMs = round(performance.now());
  console.log(`reference app listening on ${port} after ${phases.listeningMs} ms (boot ${bootId})`);
});
