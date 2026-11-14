import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import * as schema from "@/lib/db/schema";
import { projects, specifications, users } from "@/lib/db/schema";
import { createPool, type Pool } from "@/lib/db/connection";
import {
  MEETINGS_GOAL,
  MEETINGS_PROJECT_ID,
  SLOTGUARD_GOAL,
  SLOTGUARD_PROJECT_ID,
  TASKFLOW_BLOCKS,
  TASKFLOW_GOAL,
  TASKFLOW_PROJECT_ID,
} from "@/lib/canvas/kinds";
import type { Specification } from "@/lib/ai/schemas";

// One pool per server process. In development, Next reloads modules often, so the pool is kept on globalThis
// instead of opening a new set of connections on every reload.
//
// Nothing connects, or even reads DATABASE_URL, until the first query. `next build` imports every route to
// collect its settings, and it must work on a machine that has no database, so `pool` and `db` look up the
// real objects on first use.
const globalForDb = globalThis as unknown as { formaPool?: Pool; formaDb?: ReturnType<typeof makeDb> };

function getPool(): Pool {
  globalForDb.formaPool ??= createPool();
  return globalForDb.formaPool;
}

function makeDb() {
  return drizzle(getPool(), { schema });
}

function getDb() {
  globalForDb.formaDb ??= makeDb();
  return globalForDb.formaDb;
}

function lazy<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = get();
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const pool = lazy(getPool);
export const db = lazy(getDb);

const LOGIN_SPEC: Specification = {
  purpose: "Let an existing person enter TaskFlow.",
  description:
    "A single screen that accepts email and password and continues into the product after a successful sign-in. Failure behavior is intentionally unfinished.",
  functionalRequirements: [
    "Accept an email address and a password.",
    "Submit the credentials to an authentication boundary.",
    "Continue to the dashboard after a successful sign-in.",
  ],
  businessRules: ["Only an existing account can sign in."],
  dependencies: ["User"],
  edgeCases: [],
  openQuestions: [
    "What does the person see when the password is wrong?",
    "Is there a lockout, and is there a way to reset the password?",
  ],
  architecturalDecisions: [],
};

let ready: Promise<void> | null = null;

// Creates the tables and the demo data. Safe to call from every request: the work runs once per process.
// Several server instances can start at the same moment, so the setup runs under a lock that Postgres
// releases by itself if the instance dies.
export function readyDb(): Promise<void> {
  ready ??= setUp().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

const SETUP_LOCK = 724_001;

const TABLES = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      room_id TEXT NOT NULL UNIQUE,
      template TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS specifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS specifications_project_block
      ON specifications(project_id, block_id);
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL DEFAULT '',
      messages TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_project_block
      ON conversations(project_id, block_id);
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analyses_project_created
      ON analyses(project_id, created_at);
    CREATE TABLE IF NOT EXISTS research_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      query_meta_json TEXT NOT NULL,
      content_json TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_artifacts_project_kind_created
      ON research_artifacts(project_id, kind, created_at);
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      person_name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      seniority TEXT NOT NULL,
      company_name TEXT NOT NULL,
      company_domain TEXT NOT NULL,
      location TEXT NOT NULL,
      profile_urls_json TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      match_confidence DOUBLE PRECISION,
      warm_trigger TEXT NOT NULL,
      outreach_angle TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS leads_project_status
      ON leads(project_id, status);
  `;

async function setUp() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SETUP_LOCK]);
    try {
      await client.query(TABLES);
      await seedDemo();
      await seedMeetingsDemo();
      await seedSlotguardDemo();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SETUP_LOCK]);
    }
  } finally {
    client.release();
  }
}

// SlotGuard is the main demo product (docs/demo_product.md). It is listed first on the home page.
async function seedSlotguardDemo() {
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.id, "user-alex")).limit(1);
  if (!owner) return;

  await db
    .insert(projects)
    .values({
      id: SLOTGUARD_PROJECT_ID,
      name: "SlotGuard",
      ownerId: owner.id,
      roomId: "forma-project-slotguard",
      template: "slotguard",
      goal: SLOTGUARD_GOAL,
      createdAt: Date.now() + 2,
    })
    .onConflictDoNothing();
}

// The first draft of this sample used a room that still holds blocks of a kind that no longer exists.
// Moving to a new room id leaves that room behind instead of failing to sync.
const MEETINGS_ROOM_ID = "forma-project-meetings-v2";
const MEETINGS_DRAFT_ROOM_ID = "forma-project-meetings";

// Added after the first demo seed, so databases that already exist get it too.
async function seedMeetingsDemo() {
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.id, "user-alex")).limit(1);
  if (!owner) return;
  const [existing] = await db
    .select({ id: projects.id, roomId: projects.roomId, goal: projects.goal })
    .from(projects)
    .where(eq(projects.id, MEETINGS_PROJECT_ID))
    .limit(1);
  if (existing) {
    if (existing.roomId === MEETINGS_DRAFT_ROOM_ID) {
      await db
        .update(projects)
        .set({ roomId: MEETINGS_ROOM_ID, goal: MEETINGS_GOAL })
        .where(eq(projects.id, MEETINGS_PROJECT_ID));
    }
    return;
  }

  await db.insert(projects).values({
    id: MEETINGS_PROJECT_ID,
    name: "Meeting Notes",
    ownerId: owner.id,
    roomId: MEETINGS_ROOM_ID,
    template: "meetings",
    goal: MEETINGS_GOAL,
    createdAt: Date.now() + 1,
  });
}

async function seedDemo() {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return;

  const now = Date.now();
  const passwordHash = hashSync("demo", 10);

  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values([
        {
          id: "user-alex",
          name: "Alex Rivera",
          email: "alex@forma.dev",
          passwordHash,
          color: "#6ea8fe",
          createdAt: now,
        },
        {
          id: "user-sam",
          name: "Sam Chen",
          email: "sam@forma.dev",
          passwordHash,
          color: "#f0a05a",
          createdAt: now,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(projects)
      .values({
        id: TASKFLOW_PROJECT_ID,
        name: "TaskFlow",
        ownerId: "user-alex",
        roomId: "forma-project-taskflow",
        template: "taskflow",
        goal: TASKFLOW_GOAL,
        createdAt: now,
      })
      .onConflictDoNothing();

    await tx
      .insert(specifications)
      .values({
        id: "spec-taskflow-login",
        projectId: TASKFLOW_PROJECT_ID,
        blockId: TASKFLOW_BLOCKS.login,
        content: JSON.stringify(LOGIN_SPEC),
        updatedAt: now,
      })
      .onConflictDoNothing();
  });
}

export async function getUserByEmail(email: string) {
  await readyDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return user;
}

export async function getUserById(id: string) {
  await readyDb();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}
