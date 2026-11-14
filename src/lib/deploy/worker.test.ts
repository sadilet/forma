import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { loadConfig } from "./config.ts";
import { STALE_LOCK_MS } from "./contract.ts";
import type { Db } from "./db.ts";
import { realDeps } from "./pipeline.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { claimJob, enqueueJob, getJob } from "./queue.ts";
import { closeMemoryDb, memoryDb } from "./test-db.ts";
import { runWorker } from "./worker.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-worker-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
after(closeMemoryDb);

const snapshot: CanvasSnapshot = {
  blocks: [{ id: "shape:a", kind: "screen", title: "Home", description: "" }],
  connections: [],
  sketches: [],
};

async function setup(concurrency: number) {
  const db = await memoryDb();
  const config = loadConfig(
    {
      GCP_PROJECT_ID: "junction26hel-7607",
      DEPLOY_WORK_DIR: fs.mkdtempSync(path.join(tmp, "work-")),
      DEPLOY_WORKER_CONCURRENCY: String(concurrency),
      // These tests are about the queue. Never let them reach a real model.
      DEPLOY_BUILDER: "reference",
    },
    process.cwd(),
  );
  return { db, config };
}

async function queue(db: Db, projectId: string) {
  return (await enqueueJob(db, {
    projectId,
    requestedBy: "user-alex",
    template: "slotguard",
    serviceName: `forma-${projectId}`,
    snapshot,
    goal: "",
  })).job;
}

async function until(check: () => boolean | Promise<boolean>, ms = 8000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for the worker");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("the worker runs queued deploys and never runs more at once than its limit", async () => {
  const { db, config } = await setup(2);
  const jobs: Awaited<ReturnType<typeof queue>>[] = [];
  for (const id of ["p1", "p2", "p3", "p4"]) jobs.push(await queue(db, id));
  let running = 0;
  let peak = 0;
  const deps: PipelineDeps = {
    ...realDeps,
    ship: async (_config, input) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 60));
      running -= 1;
      return { url: `https://${input.serviceName}.run.app`, revision: "r1" };
    },
    health: async () => true,
  };
  const stop = new AbortController();
  const worker = runWorker({ db, config, signal: stop.signal, pollMs: 10, deps });
  await until(async () => {
    for (const job of jobs) if ((await getJob(db, job.id))?.status !== "succeeded") return false;
    return true;
  });
  stop.abort("shutdown");
  await worker;
  assert.equal(peak, 2);
  for (const job of jobs) assert.equal((await getJob(db, job.id))?.url, `https://${job.serviceName}.run.app`);
});

test("a deploy that fails does not stop the worker from taking the next one", async () => {
  const { db, config } = await setup(1);
  const bad = await queue(db, "bad");
  const good = await queue(db, "good");
  const deps: PipelineDeps = {
    ...realDeps,
    ship: async (_config, input) => {
      if (input.projectId === "bad") throw new Error("build failed");
      return { url: "https://good.run.app", revision: "r1" };
    },
    health: async () => true,
  };
  const stop = new AbortController();
  const worker = runWorker({ db, config, signal: stop.signal, pollMs: 10, deps });
  await until(async () => (await getJob(db, good.id))?.status === "succeeded");
  stop.abort("shutdown");
  await worker;
  assert.equal((await getJob(db, bad.id))?.status, "failed");
});

test("stopping the worker hands a running deploy back to the queue", async () => {
  const { db, config } = await setup(1);
  const job = await queue(db, "p1");
  let started = false;
  const deps: PipelineDeps = {
    ...realDeps,
    ship: (_config, _input, options) =>
      new Promise((_resolve, reject) => {
        started = true;
        options.signal?.addEventListener("abort", () => reject(new Error("gcloud was stopped")));
      }),
  };
  const stop = new AbortController();
  const worker = runWorker({ db, config, signal: stop.signal, pollMs: 10, deps });
  await until(async () => started);
  stop.abort("shutdown");
  await worker;
  const back = (await getJob(db, job.id))!;
  assert.equal(back.status, "queued");
  assert.equal(back.attempts, 0);
});

test("a deploy left behind by a crashed worker is picked up and finished", async () => {
  const { db, config } = await setup(1);
  const job = await queue(db, "p1");
  await claimJob(db, "dead-worker", Date.now() - STALE_LOCK_MS - 5000);
  assert.equal((await getJob(db, job.id))?.status, "running");
  const deps: PipelineDeps = {
    ...realDeps,
    ship: async () => ({ url: "https://p1.run.app", revision: "r1" }),
    health: async () => true,
  };
  const stop = new AbortController();
  const worker = runWorker({ db, config, signal: stop.signal, pollMs: 10, deps });
  await until(async () => (await getJob(db, job.id))?.status === "succeeded");
  stop.abort("shutdown");
  await worker;
  assert.equal((await getJob(db, job.id))?.attempts, 2);
});

test("an idle worker stops promptly when asked", async () => {
  const { db, config } = await setup(1);
  const stop = new AbortController();
  const started = Date.now();
  const worker = runWorker({ db, config, signal: stop.signal, pollMs: 60_000 });
  setTimeout(() => stop.abort("shutdown"), 30);
  await worker;
  assert.ok(Date.now() - started < 5000);
});
