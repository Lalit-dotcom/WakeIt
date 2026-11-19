# Measurement notes

## Session night1 (E1/E2) and e3 (E3, lazy pattern)

- **Date:** 15 November 2026
- **Start time:** about 19:40 IST (both runs started together, in two VS Code terminals)
- **Expected finish:** E1 about 23:15 IST, E3 about 03:00 IST (16 Nov)
- **Vantage:** india-laptop
- **Network:** home broadband (Airtel) over Wi-Fi 5 (802.11ac), 5 GHz band, link speed 433 Mbps. The broadband plan speed was not recorded.
- **Laptop:** Intel Core i5-1155G7 (11th gen), 8 GB RAM, Intel Iris Xe graphics; Windows 11 Home Single Language, build 26200. Make and model not recorded.
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

## Client B (second laptop, Nikhil Bhardwaj)

- **Files:** `coldstart.nikhil.csv` (40 rows) and `e3.nikhil.csv` (40 rows), vantage `nikhil-laptop`; his own notes are in `NOTES.nikhil.md`. Rows kept as received, not edited.
- **Network:** mobile hotspot, a different network from client A. Responses came mostly through the Cloudflare edge in Mumbai (BOM 36, MAA 2, DEL 1 of 39 cold starts that reported it).
- **Laptop:** Intel Core i5-12450H, 16 GB RAM.
- **Sessions:** first requests 15:32 to 18:36 IST on 17 Nov (typed label `night1`, although it ran in the afternoon) and 12:49 to 15:53 IST on 18 Nov (`day1`). E3 ran 15:32 to 22:03 IST on 17 Nov.
- **Incidents:** 18 Nov, Oregon, cycle 4: the first request was reset (ECONNRESET) and the retry succeeded; counted with its full duration (31.8 s). All 40 rows are cold starts (38 boot_id_changed, 2 uptime).
- **Naming in the paper:** client A = india-laptop, client B = nikhil-laptop. Because the typed labels do not match the clock, `analyze.py` names each session by client and date (A, 15 Nov; A, 16 Nov; B, 17 Nov; B, 18 Nov).

## After the runs

- The a11y check in `artifact-checks.txt` reported one colour-contrast violation in the warming state. Cause: the fading title text. Fixed in the library after the runs (see CHANGELOG); the experiment data are not affected, because the fading only changed how the title looked.
- Analysis: `python3 bench/analysis/analyze.py` reads every `coldstart*.csv` and `e3*.csv` in this folder and writes `bench/analysis/out/summary.json` and the three figures.
