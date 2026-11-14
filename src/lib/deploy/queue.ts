import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { MAX_ATTEMPTS, STALE_LOCK_MS } from "./contract.ts";
import type {
  BuildPlan,
  DeployEvent,
  DeployJob,
  DeployStage,
  DeployStatus,
  DeployTemplate,
  EventLevel,
} from "./contract.ts";

// A job queue on SQLite. One statement claims a job, and SQLite allows one writer at a time,
// so two workers can never claim the same job. At most one job per project runs at once.

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

export function enqueueJob(
  db: Database.Database,
  input: {
    projectId: string;
    requestedBy: string;
    template: DeployTemplate;
    serviceName: string;
    snapshot: CanvasSnapshot;
    goal: string;
  },
  now = Date.now(),
): { job: DeployJob; created: boolean } {
  const run = db.transaction(() => {
    // A second click while a deploy is waiting or running returns that deploy instead of starting another.
    const active = db
      .prepare(
        `SELECT * FROM deploy_jobs WHERE project_id = ? AND status IN ('queued', 'running')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(input.projectId) as JobRow | undefined;
    if (active) return { job: toJob(active), created: false };

    const id = randomUUID();
    db.prepare(
      `INSERT INTO deploy_jobs
         (id, project_id, requested_by, status, stage, template, service_name, snapshot_json, goal,
          attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', 'queued', ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      input.projectId,
      input.requestedBy,
      input.template,
      input.serviceName,
      JSON.stringify(input.snapshot),
      input.goal,
      now,
      now,
    );
    addEvent(db, id, "queued", "info", "Deploy queued.", now);
    return { job: getJob(db, id)!, created: true };
  });
  return run.immediate();
}

export function claimJob(db: Database.Database, workerId: string, now = Date.now()): ClaimedJob | null {
  const row = db
    .prepare(
      `UPDATE deploy_jobs
       SET status = 'running', stage = 'plan', locked_by = @worker, locked_at = @now,
           attempts = attempts + 1, updated_at = @now, error = NULL
       WHERE id = (
         SELECT j.id FROM deploy_jobs j
         WHERE j.status = 'queued'
           AND NOT EXISTS (
             SELECT 1 FROM deploy_jobs r WHERE r.project_id = j.project_id AND r.status = 'running'
           )
         ORDER BY j.created_at, j.rowid
         LIMIT 1
       )
       RETURNING *`,
    )
    .get({ worker: workerId, now }) as JobRow | undefined;
  if (!row) return null;
  return { ...toJob(row), snapshot: JSON.parse(row.snapshot_json) as CanvasSnapshot, goal: row.goal };
}

// Returns false when this worker no longer owns the job, so it can stop working on it.
export function heartbeat(db: Database.Database, jobId: string, workerId: string, now = Date.now()): boolean {
  const result = db
    .prepare(
      `UPDATE deploy_jobs SET locked_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
    )
    .run(now, now, jobId, workerId);
  return result.changes === 1;
}

export function setStage(db: Database.Database, jobId: string, stage: DeployStage, now = Date.now()) {
  db.prepare(`UPDATE deploy_jobs SET stage = ?, updated_at = ? WHERE id = ?`).run(stage, now, jobId);
}

export function savePlan(db: Database.Database, jobId: string, plan: BuildPlan, now = Date.now()) {
  db.prepare(`UPDATE deploy_jobs SET plan_json = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(plan),
    now,
    jobId,
  );
}

export function getPlan(db: Database.Database, jobId: string): BuildPlan | null {
  const row = db.prepare(`SELECT plan_json FROM deploy_jobs WHERE id = ?`).get(jobId) as
    | { plan_json: string | null }
    | undefined;
  return row?.plan_json ? (JSON.parse(row.plan_json) as BuildPlan) : null;
}

export function finishSuccess(
  db: Database.Database,
  jobId: string,
  workerId: string,
  result: { url: string | null; revision: string | null },
  now = Date.now(),
): boolean {
  const changes = db
    .prepare(
      `UPDATE deploy_jobs
       SET status = 'succeeded', stage = 'done', url = ?, revision = ?, error = NULL,
           locked_by = NULL, locked_at = NULL, finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
    )
    .run(result.url, result.revision, now, now, jobId, workerId).changes;
  return changes === 1;
}

export function finishFailure(
  db: Database.Database,
  jobId: string,
  workerId: string,
  error: string,
  now = Date.now(),
): boolean {
  const changes = db
    .prepare(
      `UPDATE deploy_jobs
       SET status = 'failed', error = ?, locked_by = NULL, locked_at = NULL, finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
    )
    .run(error.slice(0, MAX_MESSAGE), now, now, jobId, workerId).changes;
  return changes === 1;
}

// The address is saved as soon as the service exists, so it is still shown if a later check fails.
export function recordShipped(
  db: Database.Database,
  jobId: string,
  workerId: string,
  shipped: { url: string; revision: string },
  now = Date.now(),
): boolean {
  const changes = db
    .prepare(
      `UPDATE deploy_jobs SET url = ?, revision = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
    )
    .run(shipped.url, shipped.revision || null, now, jobId, workerId).changes;
  return changes === 1;
}

// A worker that is shutting down hands its job back. This does not count as an attempt.
export function releaseJob(db: Database.Database, jobId: string, workerId: string, now = Date.now()): boolean {
  const changes = db
    .prepare(
      `UPDATE deploy_jobs
       SET status = 'queued', stage = 'queued', locked_by = NULL, locked_at = NULL,
           attempts = MAX(attempts - 1, 0), updated_at = ?
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
    )
    .run(now, jobId, workerId).changes;
  return changes === 1;
}

// Jobs whose worker went silent go back to the queue, or fail after too many attempts.
export function requeueStale(db: Database.Database, now = Date.now()): number {
  const cutoff = now - STALE_LOCK_MS;
  const run = db.transaction(() => {
    const failed = db
      .prepare(
        `UPDATE deploy_jobs
         SET status = 'failed', error = 'The worker stopped responding.', locked_by = NULL, locked_at = NULL,
             finished_at = ?, updated_at = ?
         WHERE status = 'running' AND locked_at < ? AND attempts >= ?`,
      )
      .run(now, now, cutoff, MAX_ATTEMPTS).changes;
    const requeued = db
      .prepare(
        `UPDATE deploy_jobs
         SET status = 'queued', stage = 'queued', locked_by = NULL, locked_at = NULL, updated_at = ?
         WHERE status = 'running' AND locked_at < ? AND attempts < ?`,
      )
      .run(now, cutoff, MAX_ATTEMPTS).changes;
    return failed + requeued;
  });
  return run.immediate();
}

export function addEvent(
  db: Database.Database,
  jobId: string,
  stage: DeployStage,
  level: EventLevel,
  message: string,
  now = Date.now(),
) {
  db.prepare(`INSERT INTO deploy_events (job_id, at, stage, level, message) VALUES (?, ?, ?, ?, ?)`).run(
    jobId,
    now,
    stage,
    level,
    message.slice(0, MAX_MESSAGE),
  );
}

export function listEvents(db: Database.Database, jobId: string, afterId = 0, limit = 500): DeployEvent[] {
  const rows = db
    .prepare(`SELECT * FROM deploy_events WHERE job_id = ? AND id > ? ORDER BY id LIMIT ?`)
    .all(jobId, afterId, limit) as EventRow[];
  return rows.map(toEvent);
}

export function getJob(db: Database.Database, jobId: string): DeployJob | null {
  const row = db.prepare(`SELECT * FROM deploy_jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function latestJobForProject(db: Database.Database, projectId: string): DeployJob | null {
  const row = db
    .prepare(`SELECT * FROM deploy_jobs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(projectId) as JobRow | undefined;
  return row ? toJob(row) : null;
}
