# Deployment record (for the paper)

- **Date of deployment:** 15 November 2026
- **Platform / plan:** Render, Free instance type (no card, no money spent: $0)
- **How:** one Render Blueprint (`render.yaml` at repo root, named "WakeItBlueprint"), commit `d2dff78`
- **Runtime reported by the app:** Node v26.13.1 (Render default for `runtime: node`)
- **Auto-Deploy:** off for all four services (set in the Blueprint)
- **Health check path:** none

| Service | Region | URL | Use |
|---|---|---|---|
| wakeit-ref-singapore | Singapore | https://wakeit-ref-singapore.onrender.com | E1 platform/region |
| wakeit-ref-oregon | Oregon | https://wakeit-ref-oregon.onrender.com | E1 platform/region |
| wakeit-e3-a | Singapore | https://wakeit-e3-a.onrender.com | E3 WakeIt off/on |
| wakeit-e3-b | Singapore | https://wakeit-e3-b.onrender.com | E3 WakeIt off/on |

All four answered `/api/boot-info` with HTTP 200 once after deploy (database: off).
Optional hosts (Koyeb, Railway, Fly.io) and the database phase were not deployed.
