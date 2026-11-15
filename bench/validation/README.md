# Tool validation against the simulator

These files are **not measurements of any real platform**. They show that the tools report known values correctly when pointed at `example/server/server.js`, a simulator whose cold-start time is set by hand. They were produced in a cloud sandbox on 15 November 2026.

## Harness (`coldstart.mjs`) → `coldstart.sim.csv`

Simulator: `BOOT_MS=3000`, `IDLE_MS=4000`, idle wait 6 s, 3 cycles on two simulated apps per mode.

| Mode | Expected | Measured cold total | Status sequence |
|---|---|---|---|
| `hold` (request held, like Render) | 3000 ms | 3004 to 3007 ms (first cycle 3243 to 3248 ms) | `200` |
| `503` (error while booting) | 3000 ms | 3012 to 3049 ms | `503 503 503 200` |

A new boot ID was detected on every cycle after the first. The first cycle has no earlier boot ID to compare with, so it is confirmed by uptime instead.

## Browser experiment (`e3-wakeit.mjs`) → `e3.sim.csv`

Simulator: `BOOT_MS=6000`. Think-times 0, 2, 4 and 8 s, one repetition, seed 7.

`hold` mode, time at which the action completed (ms since page load):

| Think-time | Without WakeIt | With WakeIt | Saving | Model: min(think, boot) |
|---|---|---|---|---|
| 0 s | 6200 | 6227 | about 0 | 0 |
| 2 s | 8111 | 6229 | 1882 | 2000 |
| 4 s | 10131 | 6265 | 3866 | 4000 |
| 8 s | 14100 | 8098 | 6002 | 6000 |

The saving is slightly below the model for 2 s and 4 s because the page needs about 0.1 to 0.2 s to load and start the probe.

`503` mode: without WakeIt the action failed every time (the page received HTTP 503 and has no retry). With WakeIt it completed at 7396 to 8089 ms. For think-times shorter than the boot, that is 1.4 to 1.9 s after the 6 s boot ended, which is the time until WakeIt's next poll.

## Accessibility (`a11y-check.mjs`)

axe-core in Chromium, WCAG 2.x A and AA rules including colour contrast: 0 violations in the warming, ready and error states (18 rules passed in each).

## Cost model → `cost-model.csv`

Output of `node bench/cost-model.mjs` with the default 5-minute session.
