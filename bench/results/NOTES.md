# Measurement notes

## Session night1 (E1/E2) and e3 (E3, lazy pattern)

- **Date:** 15 November 2026
- **Start time:** about 19:40 IST (both runs started together, in two VS Code terminals)
- **Expected finish:** E1 about 23:15 IST, E3 about 03:00 IST (16 Nov)
- **Vantage:** india-laptop
- **Network:** Wi-Fi "Hemant" (advertised speed: TODO)
- **Laptop model / Windows version:** TODO (Windows 11 Home Single Language, build 26200)
- **Backends:** Render Free, see bench/DEPLOYED.md (deployed 15 Nov 2026, $0 spent)
- **Sleep:** standby and hibernate on AC disabled with powercfg before the start

## Incidents and rows to report (rows kept, not edited)

- night1: 20/20 rows, no errors. Cycle 1 of each target has cold_evidence "uptime"
  (no previous boot ID to compare); uptime at probe ~11 s confirms a fresh boot.
- e3: 20/20 cycles (40 rows), no errors, all cold (38 boot_id_changed, 2 uptime in cycle 1).
  Finished 02:29 IST, 16 Nov.
- day1, render-singapore, cycle 2 (05:25 UTC) and cycle 6 (06:51 UTC): no healthy answer
  within 240 s (TIMEOUT, TIMEOUT). Oregon was fine at the same times.
- day1, render-singapore, cycle 3: NOT a cold start. 239 ms, uptime at probe 1225 s:
  the instance booted at ~05:30:36 UTC from the timed-out cycle 2 request and was still
  awake 20 min later. Should be excluded from cold-start statistics and reported.
  (Cycle 7, after the cycle 6 timeout, was a genuine cold start.)

## Day session (day1)

- Started about 10:14 IST, 16 Nov (first measurement 10:34 IST), same laptop and Wi-Fi.
- Finished about 13:50 IST, 16 Nov (last row render-singapore cycle 10, 08:18 UTC). 20/20 rows.
- Valid cold starts after excluding the 2 timeouts and day1 Singapore cycle 3:
  Singapore 17 (night 10 + day 7), Oregon 20 (night 10 + day 10).
