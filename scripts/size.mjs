// Reports the minified and gzipped size of the library (React excluded).
// Usage: node scripts/size.mjs [entry] [--bundle-deps]
import { build } from "esbuild";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const entry = args.find((a) => !a.startsWith("--")) ?? "src/index.ts";
const bundleDeps = args.includes("--bundle-deps");

const external = ["react", "react-dom", "react/jsx-runtime"];
if (!bundleDeps) external.push("lucide-react");

const result = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  external,
  write: false,
  logLevel: "silent",
});

const code = result.outputFiles[0].contents;
console.log(
  JSON.stringify({
    entry,
    thirdPartyCodeIncluded: bundleDeps,
    minifiedBytes: code.length,
    gzipBytes: gzipSync(code, { level: 9 }).length,
  }),
);
