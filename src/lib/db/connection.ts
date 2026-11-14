import pg from "pg";

// One place that decides how Forma reaches Postgres. Both the Next.js app and the deploy worker use it, and
// the worker runs as plain Node, so this file uses no path aliases and no server-only import.
//
//   DATABASE_URL=postgres://user:password@host:5432/forma_local
//   DATABASE_URL=postgres://user:password@/forma?host=/cloudsql/<project>:<region>:<instance>   (Cloud Run)

export const LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/forma_local";

type Env = Record<string, string | undefined>;

export class DatabaseConfigError extends Error {}

export function databaseUrl(env: Env = process.env): string {
  const value = (env.DATABASE_URL ?? "").trim();
  if (value) return value;
  // The local default only exists so `docker compose up -d db` is enough on a laptop. Production must say where its database is.
  if (env.NODE_ENV === "production") {
    throw new DatabaseConfigError("DATABASE_URL is not set. Point it at the Postgres database (see docs/cloud.md).");
  }
  return LOCAL_DATABASE_URL;
}

// Postgres returns bigint columns (every timestamp in Forma is milliseconds in a bigint) as strings,
// which would break comparisons and arithmetic. Milliseconds since 1970 fit a JavaScript number with room to spare.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export function createPool(env: Env = process.env): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl(env),
    max: Number(env.DATABASE_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  // An idle connection that the server closed would otherwise crash the process as an unhandled event.
  pool.on("error", (error) => {
    console.error("Postgres connection error:", error.message);
  });
  return pool;
}

export type { Pool } from "pg";

// Shows where the app connects without printing the password.
export function describeDatabase(env: Env = process.env): string {
  let url: string;
  try {
    url = databaseUrl(env);
  } catch {
    return "no DATABASE_URL";
  }
  // A regular expression instead of `new URL`, which rejects the empty host of a socket address.
  const parts = /^[a-z]+:\/\/(?:[^@/]*@)?([^/?]*)\/?([^?]*)(?:\?(.*))?$/i.exec(url);
  if (!parts) return "the database in DATABASE_URL";
  const [, host, name, query] = parts;
  const socket = new URLSearchParams(query ?? "").get("host");
  return `${name || "postgres"} on ${socket ? `socket ${socket}` : host || "localhost"}`;
}
