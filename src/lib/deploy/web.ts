import "server-only";

import { pool, readyDb } from "@/lib/db";
import { ensureDeployTables, poolDb } from "./db.ts";
import type { Db } from "./db.ts";

// The deploy tables for code that runs inside Next.js. It reuses the pool the rest of the app already has.
// The worker is a separate process and opens its own (getDeployDb in db.ts). This file is the only place in
// the module that imports from the app.

let prepared: Promise<Db> | null = null;

export function getWebDeployDb(): Promise<Db> {
  prepared ??= (async () => {
    await readyDb();
    const db = poolDb(pool);
    await ensureDeployTables(db);
    return db;
  })().catch((error) => {
    prepared = null;
    throw error;
  });
  return prepared;
}
