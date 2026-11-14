import "server-only";

import type Database from "better-sqlite3";
import { db, readyDb } from "@/lib/db";
import { ensureDeployTables } from "./db.ts";

// The deploy tables for code that runs inside Next.js. It reuses the connection the rest of the app already
// has instead of opening a second one to the same file. The worker is a separate process and opens its own
// (getDeployDb in db.ts). This file is the only place in the module that imports from the app.

const prepared = new WeakSet<Database.Database>();

export function getWebDeployDb(): Database.Database {
  readyDb();
  const sqlite = db.$client;
  if (!prepared.has(sqlite)) {
    ensureDeployTables(sqlite);
    prepared.add(sqlite);
  }
  return sqlite;
}
