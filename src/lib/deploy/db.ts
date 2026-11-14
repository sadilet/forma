import { createPool } from "../db/connection.ts";
import type { Pool } from "../db/connection.ts";

// The deploy module keeps its queue in the same Postgres database as the rest of Forma, so the web app and
// any number of workers (on this machine or in the cloud) see the same jobs.
//
// The queue code talks to the small `Db` interface below instead of to `pg` directly. A pool satisfies it, and
// so does the in-process Postgres that the tests use, which means the tests run the real SQL without a server.

export type QueryResult<Row> = { rows: Row[]; rowCount: number };

export type Db = {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<Row>>;
  // Runs `work` in one transaction: it commits when `work` returns and rolls back when it throws.
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
};

export function poolDb(pool: Pool): Db {
  return {
    async query<Row>(text: string, params?: unknown[]) {
      const result = await pool.query(text, params);
      return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
    },
    async transaction<T>(work: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      const tx: Db = {
        async query<Row>(text: string, params?: unknown[]) {
          const result = await client.query(text, params);
          return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
        },
        transaction: (inner) => inner(tx), // already inside a transaction
      };
      try {
        await client.query("BEGIN");
        const value = await work(tx);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

// Several instances can start at once. The lock makes them create the tables one after another, and
// Postgres releases it by itself if an instance dies halfway.
const SETUP_LOCK = 724_002;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS deploy_jobs (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL,
    project_id TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    template TEXT NOT NULL,
    service_name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    plan_json TEXT,
    url TEXT,
    revision TEXT,
    error TEXT,
    locked_by TEXT,
    locked_at BIGINT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    finished_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS deploy_jobs_project ON deploy_jobs(project_id, created_at);
  CREATE INDEX IF NOT EXISTS deploy_jobs_status ON deploy_jobs(status, created_at);
  CREATE TABLE IF NOT EXISTS deploy_events (
    id SERIAL PRIMARY KEY,
    job_id TEXT NOT NULL,
    at BIGINT NOT NULL,
    stage TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS deploy_events_job ON deploy_events(job_id, id);
`;

export async function ensureDeployTables(db: Db) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [SETUP_LOCK]);
    await tx.query(SCHEMA);
  });
}

const globalForDeploy = globalThis as unknown as { formaDeployDb?: Promise<Db> };

// For the worker, which runs as its own process. Code inside Next.js uses getWebDeployDb (web.ts) instead,
// so the web app shares its pool with the rest of the app.
export function getDeployDb(): Promise<Db> {
  globalForDeploy.formaDeployDb ??= (async () => {
    const db = poolDb(createPool());
    await ensureDeployTables(db);
    return db;
  })();
  return globalForDeploy.formaDeployDb;
}
