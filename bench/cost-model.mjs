#!/usr/bin/env node
// E4: how many free instance hours does a backend use per month?
//
// Compares (a) a scheduled pinger that keeps the service awake all the time with
// (b) a service that is only woken by visitors (with or without WakeIt: WakeIt's
// probe is sent only when a visitor opens the page, so it wakes the server at
// the same moments a normal first request would).
//
// Inputs, from Render's documentation (https://render.com/docs/free, checked
// 15 Nov 2026): a free web service is spun down after 15 minutes without
// inbound traffic, and a workspace gets 750 free instance hours per month.
//
// Model for visitor-driven use:
//   A visit keeps the service awake for the session length plus the idle
//   timeout: W = session + 15 minutes.
//   Upper bound (no two visits overlap):   hours = visits x W
//   Estimate (visits arrive at random, i.e. a Poisson process with rate r):
//     the service is awake at a given moment if at least one visit started in
//     the last W minutes, which has probability 1 - exp(-r x W).
//     hours = hours_in_month x (1 - exp(-r x W))
//   Boot time is ignored (it adds under a minute per wake-up).
//
// Usage: node bench/cost-model.mjs [--session-min 5] [--days 30] [--csv file]
import fs from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const IDLE_TIMEOUT_MIN = 15;
const FREE_HOURS_PER_MONTH = 750;
const days = Number(arg("days", 30));
const sessionMin = Number(arg("session-min", 5));
const monthHours = days * 24;
const windowMin = sessionMin + IDLE_TIMEOUT_MIN;

const rows = [];
rows.push({
  scenario: "Pinger (every 14 min, always awake)",
  visits_per_day: "-",
  hours_upper_bound: monthHours,
  hours_estimate: monthHours,
  share_of_free_hours_pct: Math.round((monthHours / FREE_HOURS_PER_MONTH) * 1000) / 10,
  services_that_fit: Math.floor(FREE_HOURS_PER_MONTH / monthHours),
});

for (const visitsPerDay of [5, 20, 50, 100, 300]) {
  const upper = Math.min(monthHours, (visitsPerDay * days * windowMin) / 60);
  const ratePerMin = visitsPerDay / (24 * 60);
  const estimate = monthHours * (1 - Math.exp(-ratePerMin * windowMin));
  rows.push({
    scenario: "Woken by visitors only",
    visits_per_day: visitsPerDay,
    hours_upper_bound: Math.round(upper * 10) / 10,
    hours_estimate: Math.round(estimate * 10) / 10,
    share_of_free_hours_pct: Math.round((estimate / FREE_HOURS_PER_MONTH) * 1000) / 10,
    services_that_fit: Math.floor(FREE_HOURS_PER_MONTH / estimate),
  });
}

console.log(`Month of ${days} days = ${monthHours} h. Session ${sessionMin} min + idle timeout ${IDLE_TIMEOUT_MIN} min = ${windowMin} min awake per isolated visit.`);
console.log(`Free allowance: ${FREE_HOURS_PER_MONTH} instance hours per workspace per month.\n`);
console.table(rows);

const csvFile = arg("csv", null);
if (csvFile) {
  const cols = Object.keys(rows[0]);
  fs.writeFileSync(csvFile, [cols.join(","), ...rows.map((r) => cols.map((c) => `"${r[c]}"`).join(","))].join("\n") + "\n");
  console.log("Saved", csvFile);
}
