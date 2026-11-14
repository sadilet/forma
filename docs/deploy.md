# Deploy: turning a canvas into a running service

The deploy module takes a project's canvas, builds a build plan, assembles the app and ships it to Google Cloud Run. The result is a public address like `https://forma-project-slotguard-….europe-north1.run.app`.

Right now only the **SlotGuard** demo can be deployed: it has a ready-made reference app. Building from the plan with a model (an agent) is not wired in yet, but the place for it is ready; see "What's next".

## How it works

```
Deploy button in the workspace
  → POST /api/deploy        (the canvas goes to the server, the job is queued in SQLite)
  → a worker picks up the job   (separate process: npm run deploy:worker)
      1. plan    canvas JSON → ordered task list (src/lib/deploy/planner.ts)
      2. build   app folder in data/deploy/<project>/repo, one git commit per deploy
      3. ship    gcloud run deploy --source …  (Cloud Build builds the image, Cloud Run runs it)
      4. verify  poll <url>/api/health, up to 8 attempts
  → the Deploy panel in the UI shows the steps, the log and the URL
```

- A project has at most one deploy running at a time. Clicking again while a deploy is in progress returns the current one.
- If the worker dies, the job returns to the queue after a minute and runs again (at most two attempts).
- If the worker is stopped with Ctrl+C, the current deploy goes back to the queue without losing an attempt.
- The service runs with `--max-instances 1`: the reference app's SQLite lives inside the container and is recreated with demo data on every start.

## Setup for a cofounder

One-time, takes 10–15 minutes.

### 1. Install gcloud

Official guide: <https://cloud.google.com/sdk/docs/install>. Check with `gcloud --version`.

If you unpack the archive inside the project folder, that is fine: `google-cloud-sdk/` and `google-cloud-cli-*.tar.gz` are already in `.gitignore` and in the ESLint ignores. Still, it is better to keep the SDK outside the project.

### 2. Sign in and pick the project

```bash
gcloud auth login
gcloud config set project junction26hel-7607
```

This is the hackathon lab project. How you get access depends on how it was issued:

- if you have the credentials of the same lab account, `gcloud auth login` with it is enough;
- permissions in the project are granted by the organizers: the lab user cannot change IAM (`setIamPolicy`), and creating service accounts and keys is also forbidden by organization policy;
- fallback: your own Google Cloud project (there is a free starter credit). Then enable the APIs (step 3) and set your own `GCP_PROJECT_ID`.

You need at least rights on Cloud Run (`run.admin`), Cloud Build and Artifact Registry. In the lab project the user has the `editor` role plus `run.admin`, which is enough.

### 3. Enable the APIs (already enabled in the lab project)

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com
```

### 4. Check that deploying is possible at all

```bash
gcloud run deploy hello \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region=europe-north1 --allow-unauthenticated
```

Open the returned address in an incognito window. If the page opens, delete the service: `gcloud run services delete hello --region europe-north1`.

If the address answers 403, the organization forbids public access. In that case set `DEPLOY_PUBLIC_ACCESS=no-invoker-iam-check` in `.env.deploy`.

### 5. Configure Forma

```bash
cp .env.deploy.example .env.deploy
```

In `.env.deploy` fill in `GCP_PROJECT_ID` (the project ID, not the name or the number). Everything else can stay as it is.

### 6. Run

In two terminals:

```bash
npm run dev              # the app
npm run deploy:worker    # the worker: without it jobs stay in the queue
```

Open the SlotGuard workspace; the **Deploy** button is at the top right. The first build takes a few minutes, later ones about a minute.

To check the whole pipeline without Google, set `DEPLOY_DRY_RUN=1` in `.env.deploy`: the plan and the app folder are created, the cloud is not called.

## What lives where, and how not to step on each other

The whole module lives in new folders. Existing code is touched minimally:

| Where | What |
| --- | --- |
| `src/lib/deploy/` | all the logic: plan, queue, worker, `gcloud`, app folder build |
| `src/app/api/deploy/route.ts` | `POST` queues a deploy, `GET` returns status and log |
| `src/components/deploy/deploy-dock.tsx` | the button and the panel |
| `scripts/deploy-worker.ts` | worker entry point |
| `deploy-templates/slotguard/` | the SlotGuard reference app and its Dockerfile |
| `data/deploy/` | built project repositories (in `.gitignore`) |

Points where it touches the rest of the code:

- `src/components/workspace/workspace.tsx`: one import and one `<DeployDock … />` line;
- `package.json`: the `deploy:worker` and `test:deploy` scripts;
- `eslint.config.mjs` and `.gitignore`: ignore the `deploy-templates`, `google-cloud-sdk` and `data` folders;
- the shared database `data/forma.db`: the module creates its own tables `deploy_jobs` and `deploy_events` and does not touch the app schema (`db/schema.ts`).

The deploy routes live under `/api/deploy`, not `/api/build`: that path already holds `grounding`.

Tests: `npm run test:deploy`.

## Troubleshooting

| Symptom | Cause and what to do |
| --- | --- |
| The panel says "Waiting for the deploy worker" | the worker is not running: `npm run deploy:worker` |
| `"gcloud" was not found` | gcloud is not in PATH. Either install it or set `GCLOUD_BIN=/full/path/to/gcloud` |
| `PERMISSION_DENIED` or "API not enabled" | an API is not enabled or you lack rights in the project, see steps 2–3 |
| The deploy succeeded but the address answers 403 | `DEPLOY_PUBLIC_ACCESS=no-invoker-iam-check` |
| "Build failed" | the log contains a Cloud Build link with the full build journal |
| `/api/deploy` answers 422 "Only the SlotGuard demo…" | the project is not SlotGuard, or the dev server has been running for a long time and holds stale code: restart `npm run dev` |
| `SqliteError: disk I/O error` | do not open `data/forma.db` with outside programs while the dev server is running: they can delete its `-wal`/`-shm` journal. Stop the server with Ctrl+C and start it again |

## What's next

- **Agent build.** Right now the `build` step copies the ready-made app. An agent that writes the app from the plan in `planner.ts` plugs into `src/lib/deploy/build.ts`: it gets the same folder and must leave an app in it with a `Dockerfile` that listens on `$PORT` and answers on `/api/health`.
- **Rollback.** Cloud Run keeps revisions; a rollback is switching traffic to the previous one. Each deploy's revision is recorded in `deploy_jobs.revision`.
- **Entire.** The project repository already lives in `data/deploy/<project>/repo` with a commit per deploy. Pushing to Entire is an optional step after the build and does not affect the deploy.
- **Owner login.** In the reference SlotGuard the dashboard is open without a login; this is a demo. Deposit payment is mocked: no money is charged.
- **Cost.** With `DEPLOY_MIN_INSTANCES=0` the service costs nothing while idle, but the first visit after a pause waits 5–10 seconds. Before a demo you can set it to `1`.
