import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { MAX_ATTEMPTS, STALE_LOCK_MS } from "./contract.ts";
import type { Db } from "./db.ts";
import { closeMemoryDb, memoryDb } from "./test-db.ts";
import {
  addEvent,
  claimJob,
  enqueueJob,
  finishFailure,
  finishSuccess,
  getJob,
  heartbeat,
  latestJobForProject,
  listEvents,
  requeueStale,
  savePlan,
  getPlan,
} from "./queue.ts";

const snapshot: CanvasSnapshot = {
  blocks: [{ id: "shape:a", kind: "screen", title: "Home", description: "" }],
  connections: [],
  sketches: [],
};

const freshDb = memoryDb;
after(closeMemoryDb);

async function enqueue(db: Db, projectId: string, now = 1000) {
  return await enqueueJob(
    db,
    { projectId, requestedBy: "user-alex", template: "slotguard", serviceName: `forma-${projectId}`, snapshot, goal: "g" },
    now,
  );
}

test("enqueue stores the job with its snapshot and a first event", async () => {
  const db = await freshDb();
  const { job, created } = await enqueue(db, "p1");
  assert.equal(created, true);
  assert.equal(job.status, "queued");
  assert.equal(job.attempts, 0);
  assert.equal((await listEvents(db, job.id)).length, 1);
  assert.deepEqual((await claimJob(db, "w1", 2000))?.snapshot, snapshot);
});

test("a second deploy request for the same project returns the active job", async () => {
  const db = await freshDb();
  const first = await enqueue(db, "p1");
  const second = await enqueue(db, "p1");
  assert.equal(second.created, false);
  assert.equal(second.job.id, first.job.id);
  await claimJob(db, "w1", 2000);
  const third = await enqueue(db, "p1");
  assert.equal(third.created, false, "a running deploy also counts as active");
});

test("a finished deploy lets the project deploy again", async () => {
  const db = await freshDb();
  const first = await enqueue(db, "p1");
  await claimJob(db, "w1", 2000);
  await finishSuccess(db, first.job.id, "w1", { url: "https://x.run.app", revision: "r1" }, 3000);
  const next = await enqueue(db, "p1", 4000);
  assert.equal(next.created, true);
  assert.notEqual(next.job.id, first.job.id);
  assert.equal((await latestJobForProject(db, "p1"))?.id, next.job.id);
});

test("a claimed job is running, counted, and cannot be claimed twice", async () => {
  const db = await freshDb();
  await enqueue(db, "p1");
  const claimed = await claimJob(db, "w1", 2000);
  assert.equal(claimed?.status, "running");
  assert.equal(claimed?.attempts, 1);
  assert.equal(claimed?.stage, "plan");
  assert.equal((await claimJob(db, "w2", 2000)), null);
});

test("two workers claim different projects and the oldest job goes first", async () => {
  const db = await freshDb();
  const a = await enqueue(db, "pa", 1000);
  const b = await enqueue(db, "pb", 1001);
  const first = await claimJob(db, "w1", 2000);
  const second = await claimJob(db, "w2", 2000);
  assert.equal(first?.id, a.job.id);
  assert.equal(second?.id, b.job.id);
  assert.equal((await claimJob(db, "w3", 2000)), null);
});

test("only the worker that owns a job can heartbeat or finish it", async () => {
  const db = await freshDb();
  const { job } = await enqueue(db, "p1");
  await claimJob(db, "w1", 2000);
  assert.equal((await heartbeat(db, job.id, "w1", 2500)), true);
  assert.equal((await heartbeat(db, job.id, "w2", 2500)), false);
  assert.equal((await finishSuccess(db, job.id, "w2", { url: "u", revision: "r" }, 3000)), false);
  assert.equal((await getJob(db, job.id))?.status, "running");
  assert.equal((await finishFailure(db, job.id, "w1", "boom", 3000)), true);
  const done = await getJob(db, job.id);
  assert.equal(done?.status, "failed");
  assert.equal(done?.error, "boom");
  assert.equal(done?.finishedAt, 3000);
});

test("success records the address, the revision, and the done stage", async () => {
  const db = await freshDb();
  const { job } = await enqueue(db, "p1");
  await claimJob(db, "w1", 2000);
  assert.equal((await finishSuccess(db, job.id, "w1", { url: "https://x.run.app", revision: "forma-p1-00001" }, 3000)), true);
  const done = await getJob(db, job.id);
  assert.equal(done?.status, "succeeded");
  assert.equal(done?.stage, "done");
  assert.equal(done?.url, "https://x.run.app");
  assert.equal(done?.revision, "forma-p1-00001");
});

test("a silent worker loses its job once, then the job fails after too many attempts", async () => {
  const db = await freshDb();
  const { job } = await enqueue(db, "p1");
  await claimJob(db, "w1", 10_000);

  assert.equal((await requeueStale(db, 10_000 + STALE_LOCK_MS - 1)), 0, "a recent heartbeat keeps the job");
  assert.equal((await getJob(db, job.id))?.status, "running");

  assert.equal((await requeueStale(db, 10_000 + STALE_LOCK_MS + 1)), 1);
  assert.equal((await getJob(db, job.id))?.status, "queued");
  // The old worker finds out it lost the job.
  assert.equal((await heartbeat(db, job.id, "w1", 80_000)), false);

  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
    assert.equal((await claimJob(db, "w2", 100_000))?.attempts, attempt);
    await requeueStale(db, 100_000 + STALE_LOCK_MS + 1);
  }
  const final = await getJob(db, job.id);
  assert.equal(final?.status, "failed");
  assert.match(final?.error ?? "", /stopped responding/);
});

test("events come back in order and can be read from a point on", async () => {
  const db = await freshDb();
  const { job } = await enqueue(db, "p1");
  await addEvent(db, job.id, "plan", "info", "one", 2000);
  await addEvent(db, job.id, "build", "warn", "two", 2001);
  const all = await listEvents(db, job.id);
  assert.deepEqual(
    all.map((event) => event.message),
    ["Deploy queued.", "one", "two"],
  );
  assert.deepEqual(
    (await listEvents(db, job.id, all[1].id)).map((event) => event.message),
    ["two"],
  );
  assert.equal((await listEvents(db, "other-job")).length, 0);
});

test("a very long message is cut instead of failing", async () => {
  const db = await freshDb();
  const { job } = await enqueue(db, "p1");
  await addEvent(db, job.id, "ship", "error", "x".repeat(10_000), 2000);
  assert.equal((await listEvents(db, job.id)).at(-1)?.message.length, 2000);
});

test("the plan is stored and read back", async () => {
  const db = await freshDb();
  const { job } = await enqueue(db, "p1");
  assert.equal((await getPlan(db, job.id)), null);
  const plan = { version: 1 as const, summary: "s", tasks: [], warnings: ["w"] };
  await savePlan(db, job.id, plan, 2000);
  assert.deepEqual((await getPlan(db, job.id)), plan);
});
