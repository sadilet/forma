import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import pg from "pg";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { createPool } from "../db/connection.ts";
import { ensureDeployTables, poolDb } from "./db.ts";
import type { Db } from "./db.ts";
import { claimJob, enqueueJob, getJob, requeueStale } from "./queue.ts";

// The queue tests in queue.test.ts run on an in-process Postgres with one connection. What only a real server
// with many connections can show is what happens when requests arrive at the same moment: two clicks on
// Deploy, or several workers claiming together. This file checks that, and it only runs when
// TEST_DATABASE_URL points at a Postgres server (a throwaway schema is created and dropped, nothing else is touched):
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/forma_local npm run test:deploy

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to run the concurrency tests against a real Postgres";

const schema = `pgtest_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
let admin: pg.Pool;
let pool: pg.Pool;
let db: Db;

const snapshot: CanvasSnapshot = { blocks: [], connections: [], sketches: [] };
const input = (projectId: string) => ({
  projectId,
  requestedBy: "u",
  template: "slotguard",
  serviceName: `forma-${projectId}`,
  snapshot,
  goal: "",
});

before(async () => {
  if (!url) return;
  admin = createPool({ DATABASE_URL: url, DATABASE_POOL_MAX: "2" });
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Every connection of this pool looks in the throwaway schema first, so the tables are created there.
  pool = new pg.Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });
  db = poolDb(pool);
  await ensureDeployTables(db);
});

after(async () => {
  if (!url) return;
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test("many clicks on Deploy at the same moment start exactly one deploy", { skip }, async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => enqueueJob(db, input("p-race"))));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.job.id)).size, 1);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM deploy_jobs WHERE project_id = 'p-race'`);
  assert.equal(rows[0].n, 1);
});

test("workers claiming at the same moment never take the same job", { skip }, async () => {
  await db.query(`DELETE FROM deploy_jobs`); // the first test left its job queued
  const projects = Array.from({ length: 8 }, (_, index) => `p-claim-${index}`);
  for (const projectId of projects) await enqueueJob(db, input(projectId));
  const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => claimJob(db, `w${index}`)));
  const taken = claims.flatMap((claim) => (claim ? [claim.id] : []));
  assert.equal(taken.length, 8, "every job was claimed, and the four extra workers got nothing");
  assert.equal(new Set(taken).size, 8, "no job was claimed twice");
  for (const id of taken) assert.equal((await getJob(db, id))?.status, "running");
});

test("a bigint timestamp comes back as a number, and a stale job is requeued", { skip }, async () => {
  const { job } = await enqueueJob(db, input("p-stale"), 1_700_000_000_000);
  assert.equal(typeof job.createdAt, "number");
  assert.equal(job.createdAt, 1_700_000_000_000);
  const claimed = await claimJob(db, "w-stale", 1_700_000_001_000);
  assert.equal(claimed?.id, job.id);
  assert.ok((await requeueStale(db, 1_700_000_001_000 + 10 * 60 * 1000)) >= 1);
  assert.equal((await getJob(db, job.id))?.status, "queued");
});
