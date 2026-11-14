import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// The deploy module keeps its own tables in the same SQLite file as the rest of Forma.
// It opens its own connection so the worker process can use it without loading Next.js code.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS deploy_jobs (
    id TEXT PRIMARY KEY,
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
    locked_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS deploy_jobs_project ON deploy_jobs(project_id, created_at);
  CREATE INDEX IF NOT EXISTS deploy_jobs_status ON deploy_jobs(status, created_at);
  CREATE TABLE IF NOT EXISTS deploy_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    stage TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS deploy_events_job ON deploy_events(job_id, id);
`;

export function ensureDeployTables(db: Database.Database) {
  db.exec(SCHEMA);
}

const globalForDeploy = globalThis as unknown as { formaDeployDb?: Database.Database };

// For the worker, which runs as its own process. Code inside Next.js uses getWebDeployDb (web.ts) instead,
// so the web app never has two connections to the same file.
export function getDeployDb(): Database.Database {
  if (globalForDeploy.formaDeployDb) return globalForDeploy.formaDeployDb;
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "forma.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  // The web app and the worker write to the same file. Wait for the other one instead of failing.
  db.pragma("busy_timeout = 5000");
  ensureDeployTables(db);
  globalForDeploy.formaDeployDb = db;
  return db;
}
