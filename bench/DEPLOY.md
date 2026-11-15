# Deploying the reference app

The same small backend (`bench/reference-app`) is deployed on every platform. Platform facts below were checked on 15 November 2026. Sign-up screens change, so follow the idea of each step if a button has moved.

First push this repository to GitHub, because every platform deploys from it.

You need **four Render services** in total: two for the platform and region measurements (Singapore and Oregon) and two identical ones for the WakeIt off/on experiment (`e3-a` and `e3-b`, both in Singapore).

After each deployment, open `https://YOUR-URL/api/boot-info` once in a browser. You should see JSON containing `bootId` and `phases`. Then **leave the URL alone**: every visit resets the idle timer.

## Render (free, no card needed at the time of checking)

Documented behaviour: a free web service is spun down after 15 minutes without inbound traffic, and a workspace gets 750 free instance hours per month. The experiments use roughly 60 to 90 of them.

For each of the four services:

1. Dashboard, **New**, **Web Service**, connect the GitHub repository.
2. **Name**: `wakeit-ref-singapore`, `wakeit-ref-oregon`, `wakeit-e3-a`, `wakeit-e3-b`.
3. **Region**: Singapore (or Oregon for the second one). If a region is not offered for the Free type, pick the nearest one and tell me which.
4. **Root Directory**: `bench/reference-app`
5. **Build Command**: `npm install --omit=dev`
6. **Start Command**: `node index.mjs`
7. **Instance Type**: Free.
8. Leave the health check path empty.
9. Turn **Auto-Deploy off** after the first deploy, so a later `git push` does not restart the services in the middle of a run.

## Koyeb (free)

Documented behaviour: one free web service per organization, only in Frankfurt or Washington, D.C.; it scales to zero after 1 hour without traffic. Koyeb may ask for a card to prevent abuse and states that the free service is never charged.

1. **Create Web Service**, GitHub, choose the repository.
2. **Work directory**: `bench/reference-app`. Builder: Dockerfile.
3. **Instance**: Free. **Region**: Frankfurt.
4. **Port**: 8080, HTTP.
5. Deploy.

Because the idle timeout is one hour, each Koyeb cycle takes about 65 minutes. Plan for 5 cycles per session.

Koyeb's documentation says HTTP/2 requests cannot wake a sleeping service. The measurement script uses HTTP/1.1. If the browser experiment behaves oddly on Koyeb, tell me what you saw.

## Railway (optional, may cost money)

Documented at the time of checking: new accounts get a one-time $5 trial credit; there is a Free plan with $1 of credit per month; the Hobby plan costs $5 per month. The experiment needs only a few cents of usage, but check your account's current terms before starting.

1. **New Project**, **Deploy from GitHub repo**.
2. Service **Settings**: Root Directory `bench/reference-app`; Start Command `node index.mjs`.
3. **Networking**: Generate Domain.
4. **Settings**: turn on **Serverless** (formerly App Sleeping), then **redeploy**. The setting only applies to a new deployment.

Railway decides sleep from *outbound* traffic. The reference app sends none on its own.

## Fly.io (optional, needs a card)

Documented at the time of checking: new organizations are on pay-as-you-go billing. Staff have said invoices under $5 are waived for personal organizations; confirm this on your own billing page.

```powershell
cd bench\reference-app
fly auth login
fly launch --copy-config --no-deploy   # choose a unique app name; keep the settings from fly.toml
fly deploy
fly scale count 1
```

`fly.toml` sets `auto_stop_machines = "stop"` and `min_machines_running = 0`, so the Machine stops when idle and starts on the next request.

## Optional: database phase

To measure how much a database connection adds to start-up, create a free PostgreSQL database on a provider whose free tier does not expire quickly (Render's free Postgres expires 30 days after creation), and set the environment variable `DATABASE_URL` on **one extra** Render service. Leave the main four services without a database so they stay comparable.

## Record what you deployed

Copy `bench/targets.example.json` to `bench/targets.json`, replace the URLs, delete the platforms you did not deploy, and note for the paper: date of deployment, plan name, region, and any money spent.
