import { randomUUID } from "node:crypto";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { MAX_ATTEMPTS, STALE_LOCK_MS } from "./contract.ts";
import type { Db } from "./db.ts";
import type {
  BuildPlan,
  DeployEvent,
  DeployJob,
  DeployStage,
  DeployStatus,
  DeployTemplate,
  EventLevel,
} from "./contract.ts";

// A job queue on Postgres. One statement claims a job, and `FOR UPDATE SKIP LOCKED` makes two workers that
// claim at the same moment take different jobs, so a job is never run twice. At most one job per project is
// waiting or running at once.

type JobRow = {
  id: string;
  project_id: string;
  requested_by: string;
  status: DeployStatus;
  stage: DeployStage;
  template: DeployTemplate;
  service_name: string;
  snapshot_json: string;
  goal: string;
  plan_json: string | null;
  url: string | null;
  revision: string | null;
  error: string | null;
  locked_by: string | null;
  locked_at: number | null;
  attempts: number;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
};

type EventRow = {
  id: number;
  job_id: string;
  at: number;
  stage: DeployStage;
  level: EventLevel;
  message: string;
};

export type ClaimedJob = DeployJob & { snapshot: CanvasSnapshot; goal: string };

function toJob(row: JobRow): DeployJob {
  return {
    id: row.id,
    projectId: row.project_id,
    requestedBy: row.requested_by,
    status: row.status,
    stage: row.stage,
    template: row.template,
    serviceName: row.service_name,
    url: row.url,
    revision: row.revision,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function toEvent(row: EventRow): DeployEvent {
  return { id: row.id, jobId: row.job_id, at: row.at, stage: row.stage, level: row.level, message: row.message };
}

const MAX_MESSAGE = 2000;

export async function enqueueJob(
  db: Db,
  input: {
    projectId: string;
    requestedBy: string;
    template: DeployTemplate;
    serviceName: string;
    snapshot: CanvasSnapshot;
    goal: string;
  },
  now = Date.now(),
): Promise<{ job: DeployJob; created: boolean }> {
  return db.transaction(async (tx) => {
    // Two clicks at the same moment must not both pass the check below, so they take turns per project.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`deploy:${input.projectId}`]);

    // A second click while a deploy is waiting or running returns that deploy instead of starting another.
    const active = await tx.query<JobRow>(
      `SELECT * FROM deploy_jobs WHERE project_id = $1 AND status IN ('queued', 'running')
       ORDER BY created_at DESC, seq DESC LIMIT 1`,
      [input.projectId],
    );
    if (active.rows[0]) return { job: toJob(active.rows[0]), created: false };

    const id = randomUUID();
    await tx.query(
      `INSERT INTO deploy_jobs
         (id, project_id, requested_by, status, stage, template, service_name, snapshot_json, goal,
          attempts, created_at, updated_at)
       VALUES ($1, $2, $3, 'queued', 'queued', $4, $5, $6, $7, 0, $8, $8)`,
      [
        id,
        input.projectId,
        input.requestedBy,
        input.template,
        input.serviceName,
        JSON.stringify(input.snapshot),
        input.goal,
        now,
      ],
    );
    await addEvent(tx, id, "queued", "info", "Deploy queued.", now);
    return { job: (await getJob(tx, id))!, created: true };
  });
}

export async function claimJob(db: Db, workerId: string, now = Date.now()): Promise<ClaimedJob | null> {
  const { rows } = await db.query<JobRow>(
    `UPDATE deploy_jobs
     SET status = 'running', stage = 'plan', locked_by = $1, locked_at = $2,
         attempts = attempts + 1, updated_at = $2, error = NULL
     WHERE id = (
       SELECT j.id FROM deploy_jobs j
       WHERE j.status = 'queued'
         AND NOT EXISTS (
           SELECT 1 FROM deploy_jobs r WHERE r.project_id = j.project_id AND r.status = 'running'
         )
       ORDER BY j.created_at, j.seq
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [workerId, now],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toJob(row), snapshot: JSON.parse(row.snapshot_json) as CanvasSnapshot, goal: row.goal };
}

// Returns false when this worker no longer owns the job, so it can stop working on it.
export async function heartbeat(db: Db, jobId: string, workerId: string, now = Date.now()): Promise<boolean> {
  const result = await db.query(
    `UPDATE deploy_jobs SET locked_at = $1, updated_at = $1
     WHERE id = $2 AND status = 'running' AND locked_by = $3`,
    [now, jobId, workerId],
  );
  return result.rowCount === 1;
}

export async function setStage(db: Db, jobId: string, stage: DeployStage, now = Date.now()) {
  await db.query(`UPDATE deploy_jobs SET stage = $1, updated_at = $2 WHERE id = $3`, [stage, now, jobId]);
}

export async function savePlan(db: Db, jobId: string, plan: BuildPlan, now = Date.now()) {
  await db.query(`UPDATE deploy_jobs SET plan_json = $1, updated_at = $2 WHERE id = $3`, [
    JSON.stringify(plan),
    now,
    jobId,
  ]);
}

export async function getPlan(db: Db, jobId: string): Promise<BuildPlan | null> {
  const { rows } = await db.query<{ plan_json: string | null }>(`SELECT plan_json FROM deploy_jobs WHERE id = $1`, [
    jobId,
  ]);
  return rows[0]?.plan_json ? (JSON.parse(rows[0].plan_json) as BuildPlan) : null;
}

export async function finishSuccess(
  db: Db,
  jobId: string,
  workerId: string,
  result: { url: string | null; revision: string | null },
  now = Date.now(),
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE deploy_jobs
     SET status = 'succeeded', stage = 'done', url = $1, revision = $2, error = NULL,
         locked_by = NULL, locked_at = NULL, finished_at = $3, updated_at = $3
     WHERE id = $4 AND status = 'running' AND locked_by = $5`,
    [result.url, result.revision, now, jobId, workerId],
  );
  return rowCount === 1;
}

export async function finishFailure(
  db: Db,
  jobId: string,
  workerId: string,
  error: string,
  now = Date.now(),
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE deploy_jobs
     SET status = 'failed', error = $1, locked_by = NULL, locked_at = NULL, finished_at = $2, updated_at = $2
     WHERE id = $3 AND status = 'running' AND locked_by = $4`,
    [error.slice(0, MAX_MESSAGE), now, jobId, workerId],
  );
  return rowCount === 1;
}

// The address is saved as soon as the service exists, so it is still shown if a later check fails.
export async function recordShipped(
  db: Db,
  jobId: string,
  workerId: string,
  shipped: { url: string; revision: string },
  now = Date.now(),
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE deploy_jobs SET url = $1, revision = $2, updated_at = $3
     WHERE id = $4 AND status = 'running' AND locked_by = $5`,
    [shipped.url, shipped.revision || null, now, jobId, workerId],
  );
  return rowCount === 1;
}

// A worker that is shutting down hands its job back. This does not count as an attempt.
export async function releaseJob(db: Db, jobId: string, workerId: string, now = Date.now()): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE deploy_jobs
     SET status = 'queued', stage = 'queued', locked_by = NULL, locked_at = NULL,
         attempts = GREATEST(attempts - 1, 0), updated_at = $1
     WHERE id = $2 AND status = 'running' AND locked_by = $3`,
    [now, jobId, workerId],
  );
  return rowCount === 1;
}

// Jobs whose worker went silent go back to the queue, or fail after too many attempts.
export async function requeueStale(db: Db, now = Date.now()): Promise<number> {
  const cutoff = now - STALE_LOCK_MS;
  return db.transaction(async (tx) => {
    const failed = await tx.query(
      `UPDATE deploy_jobs
       SET status = 'failed', error = 'The worker stopped responding.', locked_by = NULL, locked_at = NULL,
           finished_at = $1, updated_at = $1
       WHERE status = 'running' AND locked_at < $2 AND attempts >= $3`,
      [now, cutoff, MAX_ATTEMPTS],
    );
    const requeued = await tx.query(
      `UPDATE deploy_jobs
       SET status = 'queued', stage = 'queued', locked_by = NULL, locked_at = NULL, updated_at = $1
       WHERE status = 'running' AND locked_at < $2 AND attempts < $3`,
      [now, cutoff, MAX_ATTEMPTS],
    );
    return failed.rowCount + requeued.rowCount;
  });
}

export async function addEvent(
  db: Db,
  jobId: string,
  stage: DeployStage,
  level: EventLevel,
  message: string,
  now = Date.now(),
) {
  await db.query(`INSERT INTO deploy_events (job_id, at, stage, level, message) VALUES ($1, $2, $3, $4, $5)`, [
    jobId,
    now,
    stage,
    level,
    message.slice(0, MAX_MESSAGE),
  ]);
}

export async function listEvents(db: Db, jobId: string, afterId = 0, limit = 500): Promise<DeployEvent[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT * FROM deploy_events WHERE job_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
    [jobId, afterId, limit],
  );
  return rows.map(toEvent);
}

export async function getJob(db: Db, jobId: string): Promise<DeployJob | null> {
  const { rows } = await db.query<JobRow>(`SELECT * FROM deploy_jobs WHERE id = $1`, [jobId]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function latestJobForProject(db: Db, projectId: string): Promise<DeployJob | null> {
  const { rows } = await db.query<JobRow>(
    `SELECT * FROM deploy_jobs WHERE project_id = $1 ORDER BY created_at DESC, seq DESC LIMIT 1`,
    [projectId],
  );
  return rows[0] ? toJob(rows[0]) : null;
}
