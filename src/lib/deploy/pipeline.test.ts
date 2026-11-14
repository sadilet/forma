import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { prepareRepo, repoDirFor } from "./build.ts";
import { loadConfig } from "./config.ts";
import { ensureDeployTables } from "./db.ts";
import { runJob } from "./pipeline.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { claimJob, enqueueJob, getJob, getPlan, listEvents } from "./queue.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-deploy-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const snapshot: CanvasSnapshot = {
  blocks: [
    { id: "shape:rules", kind: "decision", title: "Deposit rules", description: "Undecided: amount and cutoff." },
    { id: "shape:checkout", kind: "screen", title: "Deposit checkout", description: "Collects the deposit." },
    { id: "shape:store", kind: "database", title: "Store", description: "Persists everything." },
  ],
  connections: [
    { id: "1", fromId: "shape:rules", toId: "shape:checkout", fromTitle: "Deposit rules", toTitle: "Deposit checkout", label: "shown in" },
    { id: "2", fromId: "shape:checkout", toId: "shape:store", fromTitle: "Deposit checkout", toTitle: "Store", label: "writes" },
  ],
  sketches: [],
};

function setup(env: Record<string, string> = {}) {
  const db = new Database(":memory:");
  ensureDeployTables(db);
  const workDir = fs.mkdtempSync(path.join(tmp, "work-"));
  const config = loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_WORK_DIR: workDir, ...env }, process.cwd());
  return { db, config, workDir };
}

function queueJob(db: Database.Database, projectId = "project-slotguard") {
  enqueueJob(db, {
    projectId,
    requestedBy: "user-alex",
    template: "slotguard",
    serviceName: `forma-${projectId}`,
    snapshot,
    goal: "SlotGuard cuts no-show losses.",
  });
  return claimJob(db, "w1")!;
}

const okDeps = (overrides: Partial<PipelineDeps> = {}): PipelineDeps => ({
  ship: async () => ({ url: "https://forma-project-slotguard-abc.europe-north1.run.app", revision: "forma-project-slotguard-00001-abc" }),
  health: async () => true,
  sleep: async () => undefined,
  ...overrides,
});

const messages = (db: Database.Database, id: string) => listEvents(db, id).map((event) => event.message);

test("a dry run plans and builds but never calls Google Cloud", async () => {
  const { db, config } = setup({ DEPLOY_DRY_RUN: "1" });
  const job = queueJob(db);
  const deps = okDeps({
    ship: async () => {
      throw new Error("must not be called");
    },
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });
  assert.equal(outcome, "succeeded");
  const done = getJob(db, job.id)!;
  assert.equal(done.status, "succeeded");
  assert.equal(done.stage, "done");
  assert.equal(done.url, null);
  assert.ok(messages(db, job.id).some((message) => /Dry run/.test(message)));
  const repo = repoDirFor(config, "project-slotguard");
  assert.ok(fs.existsSync(path.join(repo, "Dockerfile")));
  assert.ok(fs.existsSync(path.join(repo, "server.mjs")));
  assert.ok(fs.existsSync(path.join(repo, ".git")));
});

test("the plan is saved and its open questions become warnings in the log", async () => {
  const { db, config } = setup({ DEPLOY_DRY_RUN: "1" });
  const job = queueJob(db);
  await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps: okDeps() });
  const plan = getPlan(db, job.id)!;
  assert.deepEqual(plan.tasks.map((task) => task.id), ["scaffold", "data", "screen:shape:checkout", "integrate"]);
  const events = listEvents(db, job.id);
  assert.ok(events.some((event) => event.level === "warn" && /Deposit rules/.test(event.message)));
  assert.ok(events.some((event) => /Plan: 4 tasks/.test(event.message)));
  const written = JSON.parse(fs.readFileSync(path.join(repoDirFor(config, "project-slotguard"), ".forma", "PLAN.json"), "utf8"));
  assert.equal(written.tasks.length, 4);
  const snapshotFile = JSON.parse(fs.readFileSync(path.join(repoDirFor(config, "project-slotguard"), ".forma", "SNAPSHOT.json"), "utf8"));
  assert.deepEqual(snapshotFile, snapshot);
});

test("a full deploy ships the repo, checks health, and records the address", async () => {
  const { db, config } = setup();
  const job = queueJob(db);
  const calls: { serviceName: string; sourceDir: string; releaseId: string }[] = [];
  const deps = okDeps({
    ship: async (_config, input, options) => {
      calls.push(input);
      for (const line of ["Building using Dockerfile", "Building using Dockerfile", "Deploying container", "Done."]) options.onLine?.(line);
      return { url: "https://svc.run.app", revision: "svc-00001" };
    },
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });
  assert.equal(outcome, "succeeded");
  const done = getJob(db, job.id)!;
  assert.equal(done.status, "succeeded");
  assert.equal(done.url, "https://svc.run.app");
  assert.equal(done.revision, "svc-00001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceDir, repoDirFor(config, "project-slotguard"));
  assert.equal(calls[0].serviceName, "forma-project-slotguard");
  assert.equal(calls[0].releaseId, job.id);
  const log = messages(db, job.id);
  assert.equal(log.filter((message) => message === "Building using Dockerfile").length, 1, "repeated lines are shown once");
  assert.ok(log.includes("Deploying container"));
});

test("a failed deploy command fails the job with the reason and no address", async () => {
  const { db, config } = setup();
  const job = queueJob(db);
  const deps = okDeps({
    ship: async () => {
      throw new Error("gcloud run deploy failed (exit 1).\nBuild failed; check build logs for details");
    },
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });
  assert.equal(outcome, "failed");
  const failed = getJob(db, job.id)!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.stage, "ship");
  assert.match(failed.error ?? "", /Build failed/);
  assert.equal(failed.url, null);
  assert.ok(listEvents(db, job.id).some((event) => event.level === "error"));
});

test("an app that never answers fails the job but keeps the address", async () => {
  const { db, config } = setup();
  const job = queueJob(db);
  let tries = 0;
  const deps = okDeps({
    health: async () => {
      tries += 1;
      return false;
    },
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });
  assert.equal(outcome, "failed");
  assert.equal(tries, 8);
  const failed = getJob(db, job.id)!;
  assert.equal(failed.stage, "verify");
  assert.match(failed.error ?? "", /did not answer/);
  assert.match(failed.url ?? "", /^https:\/\//);
});

test("an app that answers on the third try succeeds", async () => {
  const { db, config } = setup();
  const job = queueJob(db);
  let tries = 0;
  const deps = okDeps({
    health: async () => {
      tries += 1;
      return tries >= 3;
    },
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });
  assert.equal(outcome, "succeeded");
  assert.equal(tries, 3);
});

test("a shutdown during the build hands the job back without using up an attempt", async () => {
  const { db, config } = setup();
  const job = queueJob(db);
  const controller = new AbortController();
  const deps = okDeps({
    ship: (_config, _input, options) =>
      new Promise((_resolve, reject) => {
        setTimeout(() => controller.abort("shutdown"), 20);
        options.signal?.addEventListener("abort", () => reject(new Error("gcloud was stopped")));
      }),
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: controller.signal, deps });
  assert.equal(outcome, "released");
  const back = getJob(db, job.id)!;
  assert.equal(back.status, "queued");
  assert.equal(back.attempts, 0);
});

test("a job that was taken away is left alone", async () => {
  const { db, config } = setup();
  const job = queueJob(db);
  const controller = new AbortController();
  const deps = okDeps({
    ship: (_config, _input, options) =>
      new Promise((_resolve, reject) => {
        setTimeout(() => controller.abort("lost"), 20);
        options.signal?.addEventListener("abort", () => reject(new Error("gcloud was stopped")));
      }),
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: controller.signal, deps });
  assert.equal(outcome, "lost");
  assert.equal(getJob(db, job.id)!.status, "running", "the new owner decides what happens to it");
});

test("a job stops before the next stage once it is aborted", async () => {
  const { db, config } = setup();
  const job = queueJob(db);
  const controller = new AbortController();
  controller.abort("shutdown");
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: controller.signal, deps: okDeps() });
  assert.equal(outcome, "released");
});

// Some locked-down environments do not let git create a repository. The deploy still works there,
// just without history, so the history test is skipped instead of failing.
function gitCanInit() {
  const dir = fs.mkdtempSync(path.join(tmp, "git-probe-"));
  return spawnSync("git", ["init", "--quiet"], { cwd: dir }).status === 0;
}

test("each deploy of a project is a new commit in the same repo, and old files do not linger", {
  skip: gitCanInit() ? false : "git cannot create a repository in this environment",
}, async () => {
  const { config } = setup();
  const log: string[] = [];
  const base = {
    config,
    projectId: "project-slotguard",
    template: "slotguard" as const,
    snapshot,
    plan: { version: 1 as const, summary: "", tasks: [], warnings: [] },
    log: (_level: string, message: string) => log.push(message),
  };
  const first = await prepareRepo({ ...base, jobId: "job-1" });
  fs.writeFileSync(path.join(first.repoDir, "stale.txt"), "left over");
  const second = await prepareRepo({ ...base, jobId: "job-2" });
  assert.equal(second.repoDir, first.repoDir);
  assert.ok(first.commit && second.commit && first.commit !== second.commit);
  assert.equal(fs.existsSync(path.join(second.repoDir, "stale.txt")), false);
  assert.ok(fs.existsSync(path.join(second.repoDir, "Dockerfile")));
  const release = JSON.parse(fs.readFileSync(path.join(second.repoDir, ".forma", "RELEASE.json"), "utf8"));
  assert.equal(release.releaseId, "job-2");
  const count = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: second.repoDir, encoding: "utf8" });
  assert.equal(count.stdout.trim(), "2");
});

test("without git the folder is still prepared, and the missing history is reported", async () => {
  const { config } = setup();
  const log: string[] = [];
  const result = await prepareRepo({
    config,
    projectId: "no-git",
    jobId: "job-1",
    template: "slotguard",
    snapshot,
    plan: { version: 1, summary: "", tasks: [], warnings: [] },
    log: (_level, message) => log.push(message),
  });
  assert.ok(fs.existsSync(path.join(result.repoDir, "Dockerfile")));
  // Either git worked and there is a commit, or it did not and the log says so. Never a silent gap.
  if (result.commit === null) assert.ok(log.some((message) => /Could not commit the release/.test(message)));
  else assert.ok(log.some((message) => message.includes(result.commit!)));
});

test("a missing template is a clear error", async () => {
  const { config } = setup();
  await assert.rejects(
    prepareRepo({
      config: { ...config, templatesDir: path.join(tmp, "nowhere") },
      projectId: "p",
      jobId: "j",
      template: "slotguard",
      snapshot,
      plan: { version: 1, summary: "", tasks: [], warnings: [] },
      log: () => undefined,
    }),
    /missing or has no Dockerfile/,
  );
});

test("a project id can never point outside the work directory", () => {
  const { config, workDir } = setup();
  for (const id of ["../../etc", "..", "/absolute/path", "a/../../b", ""]) {
    const dir = repoDirFor(config, id);
    assert.ok(dir.startsWith(path.resolve(workDir) + path.sep), `${id} -> ${dir}`);
  }
});
