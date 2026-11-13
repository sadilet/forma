import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db, readyDb } from "@/lib/db";
import { conversations, projects, specifications } from "@/lib/db/schema";
import { chatMessageSchema, specificationSchema, type ChatMessage, type Specification } from "@/lib/ai/schemas";
import { z } from "zod";
import type { ProjectTemplate } from "@/lib/canvas/kinds";

export type ProjectRecord = {
  id: string;
  name: string;
  ownerId: string;
  roomId: string;
  template: ProjectTemplate;
  goal: string;
  createdAt: number;
};

function toProject(row: typeof projects.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    roomId: row.roomId,
    template: row.template === "taskflow" || row.template === "meetings" ? row.template : "blank",
    goal: row.goal,
    createdAt: row.createdAt,
  };
}

export function listProjects() {
  readyDb();
  return db.select().from(projects).orderBy(desc(projects.createdAt)).all().map(toProject);
}

export function getProject(id: string) {
  readyDb();
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  return row ? toProject(row) : null;
}

export function createProjectRecord(input: {
  id: string;
  name: string;
  ownerId: string;
  roomId: string;
  template: ProjectTemplate;
  goal: string;
}) {
  readyDb();
  db.insert(projects)
    .values({ ...input, createdAt: Date.now() })
    .run();
  return getProject(input.id)!;
}

export function updateProjectRecord(id: string, patch: { name?: string; goal?: string }) {
  readyDb();
  const current = getProject(id);
  if (!current) return null;
  db.update(projects)
    .set({
      name: patch.name ?? current.name,
      goal: patch.goal ?? current.goal,
    })
    .where(eq(projects.id, id))
    .run();
  return getProject(id);
}

export function getSpecification(projectId: string, blockId: string): Specification | null {
  readyDb();
  const row = db
    .select()
    .from(specifications)
    .where(and(eq(specifications.projectId, projectId), eq(specifications.blockId, blockId)))
    .get();
  if (!row) return null;
  const parsed = specificationSchema.safeParse(JSON.parse(row.content));
  return parsed.success ? parsed.data : null;
}

export function saveSpecification(projectId: string, blockId: string, content: Specification) {
  readyDb();
  const now = Date.now();
  const existing = db
    .select({ id: specifications.id })
    .from(specifications)
    .where(and(eq(specifications.projectId, projectId), eq(specifications.blockId, blockId)))
    .get();
  if (existing) {
    db.update(specifications)
      .set({ content: JSON.stringify(content), updatedAt: now })
      .where(eq(specifications.id, existing.id))
      .run();
    return;
  }
  db.insert(specifications)
    .values({
      id: crypto.randomUUID(),
      projectId,
      blockId,
      content: JSON.stringify(content),
      updatedAt: now,
    })
    .run();
}

const messagesSchema = z.array(chatMessageSchema);

export function getConversation(projectId: string, blockId: string): ChatMessage[] {
  readyDb();
  const row = db
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.blockId, blockId)))
    .get();
  if (!row) return [];
  const parsed = messagesSchema.safeParse(JSON.parse(row.messages));
  return parsed.success ? parsed.data : [];
}

export function saveConversation(projectId: string, blockId: string, messages: ChatMessage[]) {
  readyDb();
  const now = Date.now();
  const payload = JSON.stringify(messages);
  const existing = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.blockId, blockId)))
    .get();
  if (existing) {
    db.update(conversations)
      .set({ messages: payload, updatedAt: now })
      .where(eq(conversations.id, existing.id))
      .run();
    return;
  }
  db.insert(conversations)
    .values({
      id: crypto.randomUUID(),
      projectId,
      blockId,
      messages: payload,
      updatedAt: now,
    })
    .run();
}
