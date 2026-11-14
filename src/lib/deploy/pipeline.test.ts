import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { prepareRepo, repoDirFor } from "./build.ts";
import { loadConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { runJob } from "./pipeline.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { claimJob, enqueueJob, getJob, getPlan, listEvents } from "./queue.ts";
import { answerOf, appFiles, fakeLlm, indexSource } from "./test-app.ts";
import { closeMemoryDb, memoryDb } from "./test-db.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-deploy-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
after(closeMemoryDb);

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

async function setup(env: Record<string, string> = {}) {
  const db = await memoryDb();
  const workDir = fs.mkdtempSync(path.join(tmp, "work-"));
  const config = loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_WORK_DIR: workDir, DEPLOY_BUILDER: "reference", ...env }, process.cwd());
  return { db, config, workDir };
}

async function queueJob(db: Db, projectId = "project-slotguard", template = "slotguard", canvas: CanvasSnapshot = snapshot) {
  await enqueueJob(db, {
    projectId,
    requestedBy: "user-alex",
    template,
    serviceName: `forma-${projectId}`,
    snapshot: canvas,
    goal: "SlotGuard cuts no-show losses.",
  });
  return (await claimJob(db, "w1"))!;
}

const okDeps = (overrides: Partial<PipelineDeps> = {}): PipelineDeps => ({
  ship: async () => ({ url: "https://forma-project-slotguard-abc.europe-north1.run.app", revision: "forma-project-slotguard-00001-abc" }),
  health: async () => true,
  sleep: async () => undefined,
  llm: () => null,
  ...overrides,
});

const messages = async (db: Db, id: string) => (await listEvents(db, id)).map((event) => event.message);

test("a dry run plans and builds but never calls Google Cloud", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1" });
  const job = await queueJob(db);
  const deps = okDeps({
    ship: async () => {
      throw new Error("must not be called");
    },
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });
  assert.equal(outcome, "succeeded");
  const done = (await getJob(db, job.id))!;
  assert.equal(done.status, "succeeded");
  assert.equal(done.stage, "done");
  assert.equal(done.url, null);
  assert.ok((await messages(db, job.id)).some((message) => /Dry run/.test(message)));
  const repo = repoDirFor(config, "project-slotguard");
  assert.ok(fs.existsSync(path.join(repo, "Dockerfile")));
  assert.ok(fs.existsSync(path.join(repo, "server.mjs")));
  assert.ok(fs.existsSync(path.join(repo, ".git")));
});

test("the plan is saved and its open questions become warnings in the log", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1" });
  const job = await queueJob(db);
  await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps: okDeps() });
  const plan = (await getPlan(db, job.id))!;
  assert.deepEqual(plan.tasks.map((task) => task.id), ["scaffold", "data", "screen:shape:checkout", "integrate"]);
  const events = await listEvents(db, job.id);
  assert.ok(events.some((event) => event.level === "warn" && /Deposit rules/.test(event.message)));
  assert.ok(events.some((event) => /Plan: 4 tasks/.test(event.message)));
  const written = JSON.parse(fs.readFileSync(path.join(repoDirFor(config, "project-slotguard"), ".forma", "PLAN.json"), "utf8"));
  assert.equal(written.tasks.length, 4);
  const snapshotFile = JSON.parse(fs.readFileSync(path.join(repoDirFor(config, "project-slotguard"), ".forma", "SNAPSHOT.json"), "utf8"));
  assert.deepEqual(snapshotFile, snapshot);
});

test("a full deploy ships the repo, checks health, and records the address", async () => {
  const { db, config } = await setup();
  const job = await queueJob(db);
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
  const done = (await getJob(db, job.id))!;
  assert.equal(done.status, "succeeded");
  assert.equal(done.url, "https://svc.run.app");
  assert.equal(done.revision, "svc-00001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceDir, repoDirFor(config, "project-slotguard"));
  assert.equal(calls[0].serviceName, "forma-project-slotguard");
  assert.equal(calls[0].releaseId, job.id);
  const log = await messages(db, job.id);
  assert.equal(log.filter((message) => message === "Building using Dockerfile").length, 1, "repeated lines are shown once");
  assert.ok(log.includes("Deploying container"));
});

test("a failed deploy command fails the job with the reason and no address", async () => {
  const { db, config } = await setup();
  const job = await queueJob(db);
  const deps = okDeps({
    ship: async () => {
      throw new Error("gcloud run deploy failed (exit 1).\nBuild failed; check build logs for details");
    },
  });
  const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });
  assert.equal(outcome, "failed");
  const failed = (await getJob(db, job.id))!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.stage, "ship");
  assert.match(failed.error ?? "", /Build failed/);
  assert.equal(failed.url, null);
  assert.ok((await listEvents(db, job.id)).some((event) => event.level === "error"));
});

test("an app that never answers fails the job but keeps the address", async () => {
  const { db, config } = await setup();
  const job = await queueJob(db);
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
  const failed = (await getJob(db, job.id))!;
  assert.equal(failed.stage, "verify");
  assert.match(failed.error ?? "", /did not answer/);
  assert.match(failed.url ?? "", /^https:\/\//);
});

test("an app that answers on the third try succeeds", async () => {
  const { db, config } = await setup();
  const job = await queueJob(db);
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
  const { db, config } = await setup();
  const job = await queueJob(db);
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
  const back = (await getJob(db, job.id))!;
  assert.equal(back.status, "queued");
  assert.equal(back.attempts, 0);
});

test("a job that was taken away is left alone", async () => {
  const { db, config } = await setup();
  const job = await queueJob(db);
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
  assert.equal((await getJob(db, job.id))!.status, "running", "the new owner decides what happens to it");
});

test("a job stops before the next stage once it is aborted", async () => {
  const { db, config } = await setup();
  const job = await queueJob(db);
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
  const { config } = await setup();
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
  const { config } = await setup();
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
  const { config } = await setup();
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

test("a project id can never point outside the work directory", async () => {
  const { config, workDir } = await setup();
  for (const id of ["../../etc", "..", "/absolute/path", "a/../../b", ""]) {
    const dir = repoDirFor(config, id);
    assert.ok(dir.startsWith(path.resolve(workDir) + path.sep), `${id} -> ${dir}`);
  }
});

// ---- The app builder inside the pipeline ------------------------------------------------------------------------

const run = (db: Db, config: Awaited<ReturnType<typeof setup>>["config"], job: Awaited<ReturnType<typeof queueJob>>, deps: PipelineDeps) =>
  runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps });

test("the app builder writes the app, the repo records how, and no scratch files are left", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "agent" });
  const llm = fakeLlm([answerOf(appFiles("Studio"), "Booking pages.")]);
  const job = await queueJob(db, "project-taskflow", "taskflow");
  const outcome = await run(db, config, job, okDeps({ llm: () => llm }));
  assert.equal(outcome, "succeeded");
  const repo = repoDirFor(config, "project-taskflow");
  for (const file of ["Dockerfile", "kit.mjs", "server.mjs", "app/index.mjs", "public/style.css", ".forma/PLAN.json"]) {
    assert.ok(fs.existsSync(path.join(repo, file)), `${file} is missing`);
  }
  const release = JSON.parse(fs.readFileSync(path.join(repo, ".forma", "RELEASE.json"), "utf8"));
  assert.equal(release.builder, "agent");
  assert.equal(release.model, "fake-model");
  assert.equal(release.mode, "fresh");
  assert.equal(release.summary, "Booking pages.");
  assert.equal(release.goal, "SlotGuard cuts no-show losses.");
  assert.equal(fs.existsSync(path.join(repo, "..", "scratch")), false);
  const log = await messages(db, job.id);
  assert.ok(log.some((line) => /The check passed/.test(line)));
  assert.ok(log.some((line) => line === "Builder: Booking pages."));
});

test("deploying again follows the canvas: unchanged is reused, changed is an update", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "agent" });
  const llm = fakeLlm([answerOf(appFiles("Studio"))]);
  const deps = okDeps({ llm: () => llm });

  assert.equal(await run(db, config, (await queueJob(db, "project-slotguard")), deps), "succeeded");
  assert.equal(llm.calls.length, 1);

  const second = await queueJob(db, "project-slotguard");
  assert.equal(await run(db, config, second, deps), "succeeded");
  assert.equal(llm.calls.length, 1, "the same canvas does not ask the model again");
  assert.ok((await messages(db, second.id)).some((line) => /has not changed/.test(line)));

  const edited: CanvasSnapshot = structuredClone(snapshot);
  edited.blocks[0].description = "Decided: 30% deposit, cutoff 48 hours.";
  const third = await queueJob(db, "project-slotguard", "slotguard", edited);
  llm.complete = async (request) => {
    llm.calls.push({ system: request.system, messages: structuredClone(request.messages) });
    return { text: answerOf({ "app/index.mjs": indexSource("Studio 30") }, "Raised to 30%."), truncated: false };
  };
  assert.equal(await run(db, config, third, deps), "succeeded");
  assert.equal(llm.calls.length, 2);
  assert.match(llm.calls[1].messages[0].content, /Changed decision "Deposit rules"/);
  assert.match(llm.calls[1].messages[0].content, /Studio</);
  const repo = repoDirFor(config, "project-slotguard");
  assert.match(fs.readFileSync(path.join(repo, "app", "index.mjs"), "utf8"), /Studio 30/);
  assert.ok(fs.existsSync(path.join(repo, "public", "style.css")), "files the update did not touch stay");
  const release = JSON.parse(fs.readFileSync(path.join(repo, ".forma", "RELEASE.json"), "utf8"));
  assert.equal(release.mode, "update");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, ".forma", "SNAPSHOT.json"), "utf8")), edited);
});

test("a build that fails keeps the last good release on disk", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "agent" });
  assert.equal(await run(db, config, (await queueJob(db)), okDeps({ llm: () => fakeLlm([answerOf(appFiles("Good"))]) })), "succeeded");

  const edited: CanvasSnapshot = structuredClone(snapshot);
  edited.blocks[1].title = "Renamed screen";
  const broken = fakeLlm([answerOf({ "app/index.mjs": "export default function setup() { throw new Error('nope'); }\n" })]);
  const failed = await queueJob(db, "project-slotguard", "slotguard", edited);
  assert.equal(await run(db, config, failed, okDeps({ llm: () => broken })), "failed");
  const job = (await getJob(db, failed.id))!;
  assert.equal(job.stage, "build");
  assert.match(job.error ?? "", /could not produce a working app after 3 tries/);

  const repo = repoDirFor(config, "project-slotguard");
  assert.match(fs.readFileSync(path.join(repo, "app", "index.mjs"), "utf8"), /Good/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, ".forma", "SNAPSHOT.json"), "utf8")), snapshot);
});

test("with no AI key the builder says what to add", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "agent" });
  const job = await queueJob(db);
  assert.equal(await run(db, config, job, okDeps({ llm: () => null })), "failed");
  const failed = (await getJob(db, job.id))!;
  assert.equal(failed.stage, "build");
  assert.match(failed.error ?? "", /needs an AI key.*GEMINI_API_KEY/);
});

test("auto without a key ships the ready-made SlotGuard and warns that edits are not applied", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "auto" });
  const job = await queueJob(db);
  assert.equal(await run(db, config, job, okDeps({ llm: () => null })), "succeeded");
  const warn = (await listEvents(db, job.id)).find((event) => event.level === "warn" && /NOT applied/.test(event.message));
  assert.ok(warn, "the warning is in the log");
  const release = JSON.parse(fs.readFileSync(path.join(repoDirFor(config, "project-slotguard"), ".forma", "RELEASE.json"), "utf8"));
  assert.equal(release.builder, "reference");
});

test("auto without a key cannot deploy a workspace that has no ready-made app", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "auto" });
  const job = await queueJob(db, "project-blank", "blank");
  assert.equal(await run(db, config, job, okDeps({ llm: () => null })), "failed");
  assert.match((await getJob(db, job.id))!.error ?? "", /needs an AI key/);
});

test("the reference builder refuses a workspace without a ready-made app", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "reference" });
  const job = await queueJob(db, "project-blank", "blank");
  assert.equal(await run(db, config, job, okDeps({ llm: () => fakeLlm([answerOf(appFiles())]) })), "failed");
  assert.match((await getJob(db, job.id))!.error ?? "", /no ready-made app/);
});

test("a key is used even when the reference app exists, so canvas edits are applied", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "auto" });
  const llm = fakeLlm([answerOf(appFiles())]);
  const job = await queueJob(db);
  assert.equal(await run(db, config, job, okDeps({ llm: () => llm })), "succeeded");
  assert.equal(llm.calls.length, 1);
});

test("a reference release is not mistaken for an app the builder can edit", async () => {
  const { db, config } = await setup({ DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "reference" });
  assert.equal(await run(db, config, (await queueJob(db)), okDeps()), "succeeded");
  const agent = loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_WORK_DIR: config.workDir, DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "agent" }, process.cwd());
  const llm = fakeLlm([answerOf(appFiles())]);
  const job = await queueJob(db);
  assert.equal(await run(db, agent, job, okDeps({ llm: () => llm })), "succeeded");
  assert.equal(JSON.parse(fs.readFileSync(path.join(repoDirFor(agent, "project-slotguard"), ".forma", "RELEASE.json"), "utf8")).mode, "fresh");
});
