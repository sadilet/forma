import "server-only";

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import * as schema from "@/lib/db/schema";
import { projects, specifications, users } from "@/lib/db/schema";
import {
  MEETINGS_GOAL,
  MEETINGS_PROJECT_ID,
  TASKFLOW_BLOCKS,
  TASKFLOW_GOAL,
  TASKFLOW_PROJECT_ID,
} from "@/lib/canvas/kinds";
import type { Specification } from "@/lib/ai/schemas";

const globalForDb = globalThis as unknown as { formaSqlite?: Database.Database };

function openDatabase() {
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "forma.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

const sqlite = globalForDb.formaSqlite ?? openDatabase();
if (process.env.NODE_ENV !== "production") globalForDb.formaSqlite = sqlite;

export const db = drizzle(sqlite, { schema });

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

let ready = false;

export function readyDb() {
  if (ready) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      room_id TEXT NOT NULL UNIQUE,
      template TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS specifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS specifications_project_block
      ON specifications(project_id, block_id);
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL DEFAULT '',
      messages TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_project_block
      ON conversations(project_id, block_id);
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
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
      created_at INTEGER NOT NULL
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
      match_confidence REAL,
      warm_trigger TEXT NOT NULL,
      outreach_angle TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS leads_project_status
      ON leads(project_id, status);
  `);
  seedDemo();
  seedMeetingsDemo();
  ready = true;
}

// The first draft of this sample used a room that still holds blocks of a kind that no longer exists.
// Moving to a new room id leaves that room behind instead of failing to sync.
const MEETINGS_ROOM_ID = "forma-project-meetings-v2";
const MEETINGS_DRAFT_ROOM_ID = "forma-project-meetings";

// Added after the first demo seed, so databases that already exist get it too.
function seedMeetingsDemo() {
  const owner = db.select({ id: users.id }).from(users).where(eq(users.id, "user-alex")).get();
  if (!owner) return;
  const existing = db
    .select({ id: projects.id, roomId: projects.roomId, goal: projects.goal })
    .from(projects)
    .where(eq(projects.id, MEETINGS_PROJECT_ID))
    .get();
  if (existing) {
    if (existing.roomId === MEETINGS_DRAFT_ROOM_ID) {
      db.update(projects)
        .set({ roomId: MEETINGS_ROOM_ID, goal: MEETINGS_GOAL })
        .where(eq(projects.id, MEETINGS_PROJECT_ID))
        .run();
    }
    return;
  }

  db.insert(projects)
    .values({
      id: MEETINGS_PROJECT_ID,
      name: "Meeting Notes",
      ownerId: owner.id,
      roomId: MEETINGS_ROOM_ID,
      template: "meetings",
      goal: MEETINGS_GOAL,
      createdAt: Date.now() + 1,
    })
    .run();
}

function seedDemo() {
  const existing = db.select({ id: users.id }).from(users).limit(1).all();
  if (existing.length > 0) return;

  const now = Date.now();
  const passwordHash = hashSync("demo", 10);

  sqlite.transaction(() => {
    db.insert(users)
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
      .run();

    db.insert(projects)
      .values({
        id: TASKFLOW_PROJECT_ID,
        name: "TaskFlow",
        ownerId: "user-alex",
        roomId: "forma-project-taskflow",
        template: "taskflow",
        goal: TASKFLOW_GOAL,
        createdAt: now,
      })
      .run();

    db.insert(specifications)
      .values({
        id: "spec-taskflow-login",
        projectId: TASKFLOW_PROJECT_ID,
        blockId: TASKFLOW_BLOCKS.login,
        content: JSON.stringify(LOGIN_SPEC),
        updatedAt: now,
      })
      .run();
  })();
}

export function getUserByEmail(email: string) {
  readyDb();
  return db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
}

export function getUserById(id: string) {
  readyDb();
  return db.select().from(users).where(eq(users.id, id)).get();
}
