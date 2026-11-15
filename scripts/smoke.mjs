// Checks that the built package loads under plain Node ESM and CommonJS.
// Run after `npm run build`:  node scripts/smoke.mjs
import { createRequire } from "node:module";

const expected = ["WakeItProvider", "WakeItBanner", "useWakeIt", "prewarm", "getWakeItCacheKey"];

const esm = await import("../dist/index.js");
const cjs = createRequire(import.meta.url)("../dist/index.cjs");

for (const [label, mod] of [["ESM", esm], ["CJS", cjs]]) {
  const missing = expected.filter((name) => typeof mod[name] !== "function");
  if (missing.length) {
    console.error(`${label} build is missing exports: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`${label} build OK (${Object.keys(mod).length} exports)`);
}
