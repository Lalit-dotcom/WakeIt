# Runbook: collecting the measurements

Everything here runs on your Windows laptop with Node.js 20 or newer. Commands are for PowerShell, run from the repository folder.

## Three-day schedule

| Day | What you do | Your time |
|---|---|---|
| **Day 1, evening** | Deploy (see `DEPLOY.md`), one-time setup, start the night runs | about 2 hours |
| **Day 1, night** | Laptop runs E1 (platforms) and E3 (WakeIt off/on) on its own | none |
| **Day 2, daytime** | Start the day session of E1. Run the user study if you chose it | 10 min + study |
| **Day 3** | Zip `bench/results/` and send it to me | 5 min |

## One-time setup

```powershell
node -v                      # must print v20 or higher
npm install
cd bench
npm install
npx playwright install chromium
cd ..
node bench/build-demo.mjs
copy bench\targets.example.json bench\targets.json
notepad bench\targets.json   # put in your real URLs, delete platforms you did not deploy
```

Check that the tools work before the long runs:

```powershell
node bench/coldstart.mjs --targets bench/targets.json --dry-run
node bench/a11y-check.mjs
```

## Keep the laptop awake

The scripts wait 20 minutes between requests. If Windows sleeps, the run is ruined.

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

- Keep the charger plugged in and the lid **open**.
- Stay on the same Wi-Fi for the whole run. Write down which network it was (home broadband, hostel Wi-Fi, mobile hotspot).
- When all runs are finished, restore sleep: `powercfg /change standby-timeout-ac 30`

## During a run: do not touch the backends

- Do not open any of the deployed URLs in a browser.
- Do not redeploy or push to GitHub (turn Auto-Deploy off, see `DEPLOY.md`).
- Do not run two copies of the same script against the same backend.

Any extra request resets the platform's idle timer and spoils that cycle.

## E1 and E2: platform and region cold starts

**Night session** (start in the evening; about 4 hours for 10 cycles with a 20-minute idle wait):

```powershell
node bench/coldstart.mjs --targets bench/targets.json --session night1 --total 10 --vantage india-laptop
```

**Day session** (next day, between 10:00 and 18:00):

```powershell
node bench/coldstart.mjs --targets bench/targets.json --session day1 --total 10 --vantage india-laptop
```

That gives 20 cold starts per target. Ten per target (one session) is the minimum.

**Koyeb** waits 65 minutes per cycle, so 10 cycles would take 11 hours. If you deployed it, remove it from `targets.json` and run it in a second PowerShell window from a copy of the file that contains only the Koyeb entry:

```powershell
node bench/coldstart.mjs --targets bench/targets.koyeb.json --session night1 --total 5 --vantage india-laptop
```

If a run stops (power cut, crash), start the **same command again**. It counts the rows already saved for that session and continues.

Results are appended to `bench/results/coldstart.csv`, one row per cycle.

## E3: WakeIt off vs on

Uses the two identical services `wakeit-e3-a` and `wakeit-e3-b`. It can run in a second PowerShell window at the same time as E1, because it uses different backends.

```powershell
node bench/e3-wakeit.mjs --a https://wakeit-e3-a.onrender.com --b https://wakeit-e3-b.onrender.com --idle-min 20 --vantage india-laptop
```

- 20 cycles: think-times of 0, 5, 10 and 20 seconds, 5 times each, in shuffled order. About 7.5 hours.
- Each cycle opens two hidden browser windows at once, one without WakeIt and one with it. The backends swap roles every cycle.
- If it stops, run the same command again. It resumes with the same shuffle.
- Add `--headed` if you want to watch the windows.

Results are appended to `bench/results/e3.csv`, two rows per cycle.

Optional second batch for the "page loads data on open" pattern, on another night:

```powershell
node bench/e3-wakeit.mjs --a <A> --b <B> --idle-min 20 --pattern eager --session e3-eager --reps 3 --vantage india-laptop
```

## E4: free-hour cost model (no waiting)

```powershell
node bench/cost-model.mjs --csv bench/results/cost-model.csv
```

## E5: user study (optional)

See `bench/user-study/README.md`.

## E6: library checks (no waiting)

```powershell
npm run test:coverage
npm run build
npm run smoke
npm run size
node bench/a11y-check.mjs
```

Copy the printed output into a text file `bench/results/artifact-checks.txt`.

## Optional second vantage point: GitHub Actions

`.github/workflows/coldstart.yml` runs the same harness on a GitHub-hosted runner, which is not in India. Commit `bench/targets.json`, push, then on GitHub open **Actions**, **Cold-start measurement**, **Run workflow**. Download the CSV from the run's **Artifacts** when it finishes. One job can run for at most 6 hours, so it does 10 cycles of the 20-minute targets. Do not run it at the same time as the laptop run against the same backends.

## What to write down for the paper

- Dates and start times of every session.
- Internet connection used and its advertised speed.
- Laptop model and Windows version.
- Platforms, plans and regions deployed, and any money spent.
- Anything unusual (Wi-Fi dropped at 02:00, a platform showed an incident, and so on).

Put these notes in `bench/results/NOTES.md`.

## Sending the results

Zip the whole `bench/results/` folder and send it. **Do not edit the CSV files**, not even to remove a row that looks wrong. Tell me about odd rows instead; every excluded row has to be reported in the paper.
