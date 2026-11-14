# Deploy: turning a canvas into a running service

The deploy module takes a project's canvas, builds a build plan, has a model write the app, checks that it runs, and ships it to Google Cloud Run. The result is a public address like `https://forma-project-slotguard-….europe-north1.run.app`.

**Any workspace can be deployed**, SlotGuard included. Edit the canvas and press Deploy again: the app is updated to match, and the address stays the same.

## How it works

```
Deploy button in the workspace
  → POST /api/deploy        (the canvas goes to the server, the job is queued in Postgres)
  → a worker picks up the job   (separate process: npm run deploy:worker, or the forma-worker service in the cloud, see cloud.md)
      1. plan    canvas JSON → ordered task list (src/lib/deploy/planner.ts)
      2. build   the app builder writes the app and checks it (see below), then the folder
                 data/deploy/<project>/repo gets one git commit per deploy
      3. ship    gcloud run deploy --source …  (Cloud Build builds the image, Cloud Run runs it)
      4. verify  poll <url>/api/health, up to 8 attempts
  → the Deploy panel in the UI shows the steps, the log and the URL
```

## The app builder

The `build` step asks a model (Gemini or OpenAI, the same keys as the rest of Forma) to write the app from the canvas. The model does not write a server from scratch: Forma provides a small runtime (`deploy-templates/runtime/`: HTTP server, in-memory SQLite, helpers, `/api/health`, Dockerfile) and the model writes only the app on top of it, in `app/*.mjs` and `public/*`. The contract between the two is the system prompt in `src/lib/deploy/prompt.ts` and `kit.mjs`; change them together.

What the model is given: the product goal, every block and arrow of the canvas, the decisions that bind each block, and the open questions. Open decisions get a sensible default that is listed on the app's `/about` page. Payments, email and SMS are simulated; there is no real login.

**Nothing is shipped before it is checked.** After each answer Forma:

1. applies the rules: allowed paths and sizes, no packages, no network calls, no `eval`, no imports of anything but a few `node:` built-ins;
2. starts the app and opens `/`, `/about`, every page the app lists in its `smoke` list and every plain GET route. Any answer of 500, or a 404 on a required page, is a problem;
3. sends the problems back to the model, up to two times, and only then fails the deploy with the problems in the message.

The app is started in a separate Node process with the permission model: it can read its own folder and nothing else. It cannot write files, start programs or open sockets, and it gets an empty environment, so it never sees your API keys.

**Updates follow the canvas.** The release that last passed its check is kept in `data/deploy/<project>/repo`, together with the canvas it was built from. On the next deploy Forma compares the canvases (blocks, text, arrows and the goal; moving a block is not a change) and:

| Canvas | What happens |
| --- | --- |
| first deploy | the model writes the whole app |
| changed | the model gets the list of changes and the current files and edits only what it must; the rest of the app and its demo data stay as they were |
| not changed | the same files are checked and shipped again, the model is not called |

A failed build never touches the last good release. To start over from a clean slate, delete `data/deploy/<project>/` (the next deploy writes a new app from scratch).

A build takes one to three minutes of model time on top of the first Cloud Build. The log in the Deploy panel shows every step.

## Saving projects to git

Without this, a project's code lives only in `data/deploy/<project>/repo` on the machine that ran the worker. Set `DEPLOY_GIT_REMOTE` (and, for an SSH address, `DEPLOY_GIT_SSH_KEY`) in `.env.deploy` and the worker keeps the repo in step with a shared remote:

- **After each build**, the new release is pushed to the branch named after the project (`project-slotguard`). One remote repository holds all projects. A push is never forced, and a failed push is a warning in the log: the deploy goes on.
- **Before each build**, the worker fetches that branch. On a new machine, or after `data/deploy/` was deleted, it restores the project from there, so the next deploy is an update of the last release instead of a new app. If another machine deployed in between, the worker moves forward to that release first. If both sides have releases the other lacks, the worker keeps its own copy and says so in the log, and its push is refused rather than overwriting the remote.
- Each branch holds the app, `.forma/SNAPSHOT.json` (the canvas it was built from), `.forma/PLAN.json` and `.forma/RELEASE.json`. **If the remote is public, so is the canvas text.** Use a private repository for real projects.
- Any git host works. For GitHub, add the public key as a deploy key with write access (or use your own key). By default the project uses the shared demo key `example_github_ssh` from the project root, which is **committed to the repository on purpose**: anyone with access to this repository can push to `sadilet/forma-examples`. That is fine for a demo repo and not for anything else. For real projects, point `DEPLOY_GIT_SSH_KEY` at your own key outside the project folder. The worker runs `chmod 600` on the key itself, because ssh refuses a key other users can read.

## Rules of the pipeline

- A project has at most one deploy running at a time. Clicking again while a deploy is in progress returns the current one.
- If the worker dies, the job returns to the queue after a minute and runs again (at most two attempts).
- If the worker is stopped with Ctrl+C, the current deploy goes back to the queue without losing an attempt.
- The service runs with `--max-instances 1`: the app's SQLite lives in memory inside the container and is recreated with demo data on every start.

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

Open a workspace; the **Deploy** button is at the top right. The first deploy takes a few minutes, later ones about a minute plus the model's time.

The worker needs an AI key to write apps: `GEMINI_API_KEY` or `OPENAI_API_KEY` in `.env.local` (it reads the same file as the app). The worker prints which builder it will use when it starts.

To check the whole pipeline without Google Cloud, set `DEPLOY_DRY_RUN=1` in `.env.deploy`: the plan is made, the model writes the app, the app is checked and the folder is created, but the cloud is not called. The model is still called, so it uses a little of your AI quota.

`DEPLOY_BUILDER` chooses who writes the app: `auto` (default: the model when there is a key, otherwise the ready-made SlotGuard), `agent` (always the model) or `reference` (always the ready-made SlotGuard, with no AI calls and no canvas edits; handy as a safety net before a live demo).

## What lives where, and how not to step on each other

The whole module lives in new folders. Existing code is touched minimally:

| Where | What |
| --- | --- |
| `src/lib/deploy/` | all the logic: plan, queue, worker, app builder, `gcloud`, app folder build |
| `src/app/api/deploy/route.ts` | `POST` queues a deploy, `GET` returns status and log |
| `src/components/deploy/deploy-dock.tsx` | the button and the panel |
| `scripts/deploy-worker.ts` | worker entry point |
| `deploy-templates/runtime/` | the runtime every generated app runs on (server, helpers, check, Dockerfile) |
| `deploy-templates/slotguard/` | the ready-made SlotGuard app, a fallback for `DEPLOY_BUILDER=reference` |
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
| "The app builder needs an AI key" | add `GEMINI_API_KEY` (or `OPENAI_API_KEY`) to `.env.local` and restart the worker |
| "The app builder … failed: 429 …" or "503" | the model is busy or out of quota. Busy answers are retried twice on their own; otherwise wait and deploy again, or set `DEPLOY_MODEL` |
| "could not produce a working app after 3 tries" | the log lists what the check found. Deploy again (the model usually fixes it on a new run), or put the problem into the canvas text, or use `DEPLOY_BUILDER=reference` for SlotGuard |
| The model's answer was cut off | raise `DEPLOY_MAX_OUTPUT_TOKENS` if your model allows it, or split the canvas into a smaller product |
| `ECONNREFUSED 127.0.0.1:5432` | the local database is not running: `docker compose up -d db` |

## What's next

- **Rollback.** Cloud Run keeps revisions; a rollback is switching traffic to the previous one. Each deploy's revision is recorded in `deploy_jobs.revision`.
- **Entire.** The remote can be any git host; Entire should work the same way if it gives you a git address, but that has not been tried.
- **Real services.** Generated apps keep their data in memory and simulate payments, email and SMS. A real database, real providers and owner login are separate steps that need secrets and a persistent store.
- **Owner login.** The generated apps have no login: owner and admin areas are open. This is a demo.
- **Cost.** With `DEPLOY_MIN_INSTANCES=0` the service costs nothing while idle, but the first visit after a pause waits 5–10 seconds. Before a demo you can set it to `1`.
