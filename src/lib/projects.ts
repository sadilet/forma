import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db, readyDb } from "@/lib/db";
import { conversations, projects, specifications } from "@/lib/db/schema";
import { mergeMessages } from "@/lib/collab/messages";
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
    template:
      row.template === "taskflow" || row.template === "meetings" || row.template === "slotguard"
        ? row.template
        : "blank",
    goal: row.goal,
    createdAt: row.createdAt,
  };
}

export async function listProjects() {
  await readyDb();
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  return rows.map(toProject);
}

export async function getProject(id: string) {
  await readyDb();
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ? toProject(row) : null;
}

export async function createProjectRecord(input: {
  id: string;
  name: string;
  ownerId: string;
  roomId: string;
  template: ProjectTemplate;
  goal: string;
}) {
  await readyDb();
  await db.insert(projects).values({ ...input, createdAt: Date.now() });
  return (await getProject(input.id))!;
}

export async function updateProjectRecord(id: string, patch: { name?: string; goal?: string }) {
  await readyDb();
  const current = await getProject(id);
  if (!current) return null;
  await db
    .update(projects)
    .set({
      name: patch.name ?? current.name,
      goal: patch.goal ?? current.goal,
    })
    .where(eq(projects.id, id));
  return getProject(id);
}

async function findSpecification(projectId: string, blockId: string) {
  const [row] = await db
    .select()
    .from(specifications)
    .where(and(eq(specifications.projectId, projectId), eq(specifications.blockId, blockId)))
    .limit(1);
  return row;
}

export async function getSpecificationRecord(projectId: string, blockId: string) {
  await readyDb();
  const row = await findSpecification(projectId, blockId);
  if (!row) return { specification: null, updatedAt: null };
  const parsed = specificationSchema.safeParse(JSON.parse(row.content));
  return {
    specification: parsed.success ? parsed.data : null,
    updatedAt: parsed.success ? row.updatedAt : null,
  };
}

export async function getSpecification(projectId: string, blockId: string): Promise<Specification | null> {
  return (await getSpecificationRecord(projectId, blockId)).specification;
}

// Two people saving the same block at once: the unique (project, block) index decides which write lands
// first, and the update below only applies if the row still has the version the caller saw.
export async function writeSpecification(
  projectId: string,
  blockId: string,
  content: Specification,
  expectedUpdatedAt: number | null,
) {
  await readyDb();
  const now = Date.now();
  const payload = JSON.stringify(content);

  if (expectedUpdatedAt === null) {
    const inserted = await db
      .insert(specifications)
      .values({ id: crypto.randomUUID(), projectId, blockId, content: payload, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: specifications.id });
    if (inserted.length === 1) return { conflict: false as const, updatedAt: now };
  } else {
    const updated = await db
      .update(specifications)
      .set({ content: payload, updatedAt: now })
      .where(
        and(
          eq(specifications.projectId, projectId),
          eq(specifications.blockId, blockId),
          eq(specifications.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning({ id: specifications.id });
    if (updated.length === 1) return { conflict: false as const, updatedAt: now };
  }

  const current = await getSpecificationRecord(projectId, blockId);
  return { conflict: true as const, ...current };
}

export async function saveSpecification(projectId: string, blockId: string, content: Specification) {
  await readyDb();
  const now = Date.now();
  const payload = JSON.stringify(content);
  await db
    .insert(specifications)
    .values({ id: crypto.randomUUID(), projectId, blockId, content: payload, updatedAt: now })
    .onConflictDoUpdate({
      target: [specifications.projectId, specifications.blockId],
      set: { content: payload, updatedAt: now },
    });
}

const messagesSchema = z.array(chatMessageSchema);

export async function getConversation(projectId: string, blockId: string): Promise<ChatMessage[]> {
  await readyDb();
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.blockId, blockId)))
    .limit(1);
  if (!row) return [];
  const parsed = messagesSchema.safeParse(JSON.parse(row.messages));
  return parsed.success ? parsed.data : [];
}

// Two people sending a message at the same moment must not lose either one, so the read, merge and write
// happen in one transaction, and a lock on the row keeps a second writer waiting for the first.
export async function mergeConversation(projectId: string, blockId: string, incoming: ChatMessage[]) {
  await readyDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`conversation:${projectId}:${blockId}`}))`);
    const [row] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), eq(conversations.blockId, blockId)))
      .limit(1);
    const parsed = row ? messagesSchema.safeParse(JSON.parse(row.messages)) : null;
    const merged = mergeMessages(parsed?.success ? parsed.data : [], incoming);
    const payload = JSON.stringify(merged);
    const now = Date.now();
    await tx
      .insert(conversations)
      .values({ id: crypto.randomUUID(), projectId, blockId, messages: payload, updatedAt: now })
      .onConflictDoUpdate({
        target: [conversations.projectId, conversations.blockId],
        set: { messages: payload, updatedAt: now },
      });
    return merged;
  });
}

export async function saveConversation(projectId: string, blockId: string, messages: ChatMessage[]) {
  await readyDb();
  const now = Date.now();
  const payload = JSON.stringify(messages);
  await db
    .insert(conversations)
    .values({ id: crypto.randomUUID(), projectId, blockId, messages: payload, updatedAt: now })
    .onConflictDoUpdate({
      target: [conversations.projectId, conversations.blockId],
      set: { messages: payload, updatedAt: now },
    });
}
