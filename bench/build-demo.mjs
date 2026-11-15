// Builds the E3 demo page into bench/e3-demo/dist (two files: index.html, app.js).
// Usage: node bench/build-demo.mjs
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "e3-demo", "dist");
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(here, "e3-demo", "src", "main.tsx")],
  outfile: path.join(outDir, "app.js"),
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

fs.writeFileSync(
  path.join(outDir, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WakeIt experiment page</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./app.js"></script>
  </body>
</html>
`,
);
console.log("Demo built in", outDir);
