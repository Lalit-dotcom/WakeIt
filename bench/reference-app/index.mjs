// Entry point. It records the time before any other module is loaded, then
// loads the app. (Static imports run before a module's own code, so the first
// timestamp has to live in a file that imports nothing heavy.)
import { performance } from "node:perf_hooks";

globalThis.__wakeitBoot = {
  // ms from process start until this line ran (Node's own start-up time)
  entryMs: performance.now(),
  // wall-clock time at which the process started
  processStartEpochMs: performance.timeOrigin,
};

await import("./app.mjs");
