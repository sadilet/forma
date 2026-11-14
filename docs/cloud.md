# Running Forma itself on Google Cloud

Forma is two services on Cloud Run that share one Postgres database (Cloud SQL):

```
 browser ──► forma          (Next.js, scales 0–5 instances)  ─┐
                                                              ├──► Cloud SQL Postgres, database "forma"
 Deploy button ► queue ──►  forma-worker  (always on, 1 instance)
                              └─ writes an app from the canvas, builds it, runs it on Cloud Run
                                 as its own service (see deploy.md)
```

The web app and the worker never talk to each other. The web app puts a job in the `deploy_jobs` table, the worker takes it from there, and the web app reads the progress from `deploy_events`. That is why they can run anywhere, including one on a laptop and one in the cloud.

## Put it online

Needs `gcloud auth login` and these lines in `.env.deploy` (the file is not committed):

```
GCP_PROJECT_ID=junction26hel-7607
POSTGRES_PASSWORD=<password of the Cloud SQL user "postgres">
```

```bash
npm run cloud:deploy              # both services
npm run cloud:deploy -- web       # only the web app
npm run cloud:deploy -- worker    # only the deploy worker
```

The script turns on the APIs it needs, creates the database `forma` and an image repository if they are missing, builds the images in Cloud Build (no Docker on your machine), and starts the services. Run it again after a code change. A run takes about 4 minutes per service. At the end it prints the address of the web app.

What each service receives as settings (see `src/lib/deploy/cloud.ts`):

| | forma (web) | forma-worker |
| --- | --- | --- |
| Database | `DATABASE_URL` through a Cloud SQL socket | same |
| Login cookie | `SESSION_SECRET`, made once and kept in `.env.cloud` | not needed |
| AI keys | `GEMINI_*`, `OPENAI_*`, `AI_PROVIDER` from `.env.local` | same, to write the apps |
| Other | `LIVEBLOCKS_SECRET_KEY`, `CONTEXT_DEV_API_KEY` | `DEPLOY_*` from `.env.deploy`, `GCP_PROJECT_ID`, `GCP_REGION` |

Settings are passed to Cloud Run as environment variables from a file with owner-only access, not on the command line. Anyone with access to the Google Cloud project can read them in the console. For anything beyond a hackathon, move the keys to Secret Manager.

The worker runs as the project's default compute service account, which has the Editor role in this project. That is what lets it build and deploy without any key file. In a stricter project, give that account Cloud Run Admin, Cloud Build Editor, Artifact Registry Writer, Storage Admin and Service Account User.

Because a Cloud Run container is thrown away at any time, the worker keeps no state on its disk that matters: each project is restored from the git remote (`DEPLOY_GIT_REMOTE`, see deploy.md) before every build.

## Locally

The same code runs against a Postgres in Docker. Nothing to set:

```bash
docker compose up -d db     # Postgres 18, database "forma_local", on 127.0.0.1:5432
npm run dev
npm run deploy:worker       # optional: a local worker, on the same database
```

Do not run a local worker and the cloud worker on the same database unless you want both to take jobs. That is safe (a job is taken by exactly one of them), but a deploy then runs on whichever machine was faster.

To use the cloud database from a laptop, run the Cloud SQL Auth Proxy (it uses your `gcloud` login, no IP allow-list):

```bash
cloud-sql-proxy --gcloud-auth --port 5433 junction26hel-7607:europe-north1:forma
DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5433/forma_local npm run dev
```

## Data

- Tables are created by the app on first start (`readyDb` in `src/lib/db/index.ts`) and by the worker (`ensureDeployTables` in `src/lib/deploy/db.ts`). Both run under a database lock, so starting several instances at once is safe.
- Demo users (`alex@forma.dev`, `sam@forma.dev`, password `demo`) and the three demo workspaces are created in an empty database. **The deployed app is public and has these accounts.** Change the seed or remove them before showing it to anyone you do not trust.
- Data in an old `data/forma.db` (SQLite) is not copied over.

## Tests

- `npm run test:deploy` runs the queue and pipeline on an in-process Postgres (PGlite), so it needs no server.
- Races between real connections (two clicks on Deploy, several workers claiming at once) are tested against a real server when `TEST_DATABASE_URL` is set:
  `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/forma_local npm run test:deploy`. The test uses a throwaway schema.

## Troubleshooting

| Symptom | Cause and what to do |
| --- | --- |
| `DATABASE_URL is not set` in the logs | the service was started without it. Run `npm run cloud:deploy` again |
| The web app answers 500 and the logs say `password authentication failed` | `POSTGRES_PASSWORD` is wrong. Fix `.env.deploy` and run `npm run cloud:deploy` |
| `The user is not authorized` / `cloudsql.instances.connect` | the service account lacks Cloud SQL Client. Add the role `roles/cloudsql.client` to it |
| The Deploy panel says "Waiting for the deploy worker" | the worker is not running or cannot reach the database: `gcloud run services logs read forma-worker --region europe-north1` |
| Everybody is signed out after a deploy | `SESSION_SECRET` changed. Keep `.env.cloud` |
