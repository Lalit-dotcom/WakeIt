#!/usr/bin/env node
// Serves the experiment page on this computer and prints the two links
// (without and with WakeIt). Used for the user study and for trying things out.
//
// Usage: node bench/serve-demo.mjs --a https://backend-a.example --b https://backend-b.example
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "e3-demo", "dist");
if (!fs.existsSync(path.join(root, "app.js"))) {
  console.error("Demo page not built. Run: node bench/build-demo.mjs");
  process.exit(1);
}
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const a = arg("a"), b = arg("b");
if (!a || !b) {
  console.error("Usage: node bench/serve-demo.mjs --a <backend A url> --b <backend B url>");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const name = req.url.split("?")[0] === "/" ? "index.html" : path.basename(req.url.split("?")[0]);
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": name.endsWith(".js") ? "text/javascript" : "text/html", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(arg("port") ?? 5180), "127.0.0.1", () => {
  const base = `http://127.0.0.1:${server.address().port}/`;
  const link = (mode, api) => `${base}?mode=${mode}&api=${encodeURIComponent(api)}`;
  console.log("Open each link in a NEW private (incognito) window.\n");
  console.log("Version 1 (no WakeIt) on backend A:  ", link("off", a));
  console.log("Version 2 (WakeIt)    on backend B:  ", link("on", b));
  console.log("\nSwapped backends, for every second participant:");
  console.log("Version 1 (no WakeIt) on backend B:  ", link("off", b));
  console.log("Version 2 (WakeIt)    on backend A:  ", link("on", a));
  console.log("\nPress Ctrl+C to stop.");
});
