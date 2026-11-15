#!/usr/bin/env node
// E6: accessibility check of the WakeIt banner in a real browser (Chromium).
// Runs axe-core (WCAG 2.x level A and AA rules, including colour contrast) on
// the warming, ready and error states. Needs no backend: replies are simulated.
//
// Usage: node bench/build-demo.mjs && node bench/a11y-check.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "e3-demo", "dist");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const { chromium } = require("playwright");

const server = http.createServer((req, res) => {
  const name = req.url.split("?")[0] === "/" ? "index.html" : path.basename(req.url.split("?")[0]);
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": name.endsWith(".js") ? "text/javascript" : "text/html" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/?mode=on&a11y=1&api=${encodeURIComponent("http://backend.test")}`;

const browser = await chromium.launch();
const report = [];

async function check(state, healthStatus, healthDelayMs, waitFor) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("http://backend.test/**", async (route) => {
    await new Promise((r) => setTimeout(r, healthDelayMs));
    await route.fulfill({
      status: healthStatus,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ status: healthStatus === 200 ? "ok" : "error" }),
    });
  });
  await page.goto(base);
  await page.waitForSelector(`[data-wakeit-banner="${waitFor}"]`, { timeout: 20_000 });
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }),
  );
  const live = await page.locator("[data-wakeit-live]").textContent();
  report.push({
    state,
    rulesPassed: result.passes.length,
    violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
    liveRegionText: live,
  });
  await context.close();
}

await check("warming", 200, 6000, "warming");
await check("ready", 200, 2500, "ready");
await check("error", 500, 50, "error");

await browser.close();
server.close();

console.log(JSON.stringify(report, null, 2));
const total = report.reduce((n, r) => n + r.violations.length, 0);
console.log(total === 0 ? "No WCAG A/AA violations found in the three banner states." : `${total} violation type(s) found.`);
process.exit(total === 0 ? 0 : 1);
