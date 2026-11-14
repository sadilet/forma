import { PGlite, types } from "@electric-sql/pglite";
import { ensureDeployTables } from "./db.ts";
import type { Db, QueryResult } from "./db.ts";

// A real Postgres that runs inside the test process, so the queue tests run the same SQL as production
// without needing a server or Docker. Each call gives a new, empty database.

type Runner = Pick<PGlite, "query" | "exec">;

function adapt(runner: Runner, transaction: Db["transaction"]): Db {
  return {
    async query<Row>(text: string, params?: unknown[]): Promise<QueryResult<Row>> {
      // `exec` accepts several statements in one string, which the schema needs. `query` takes parameters.
      if (!params || params.length === 0) {
        const results = await runner.exec(text);
        const last = results[results.length - 1];
        return { rows: (last?.rows ?? []) as Row[], rowCount: last?.affectedRows ?? last?.rows.length ?? 0 };
      }
      const result = await runner.query(text, params);
      return { rows: result.rows as Row[], rowCount: result.affectedRows ?? result.rows.length };
    },
    transaction,
  };
}

// Starting Postgres takes a moment, so a test file starts it once and every test gets the tables emptied.
// Tests inside one file run one after another, so they never share rows.
let shared: Promise<{ pg: PGlite; db: Db }> | null = null;

export async function memoryDb(): Promise<Db> {
  shared ??= (async () => {
    const pg = await PGlite.create({
      parsers: { [types.INT8]: (value: string) => Number(value) },
    });
    const db: Db = adapt(pg, (work) =>
      pg.transaction(async (tx) => {
        const inner: Db = adapt(tx as unknown as Runner, (nested) => nested(inner));
        return work(inner);
      }),
    );
    await ensureDeployTables(db);
    return { pg, db };
  })();
  const { db } = await shared;
  await db.query("TRUNCATE deploy_jobs, deploy_events RESTART IDENTITY");
  return db;
}

// Call from `after(...)` in a test file, or the process waits for the database to time out before it exits.
export async function closeMemoryDb() {
  if (!shared) return;
  const { pg } = await shared;
  shared = null;
  await pg.close();
}
