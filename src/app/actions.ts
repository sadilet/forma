"use server";

import { compareSync } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, getCurrentUser, setSession } from "@/lib/auth";
import { getUserByEmail } from "@/lib/db";
import {
  MEETINGS_GOAL,
  PROJECT_TEMPLATES,
  SLOTGUARD_GOAL,
  TASKFLOW_GOAL,
  type ProjectTemplate,
} from "@/lib/canvas/kinds";
import { publishResourceUpdate } from "@/lib/collab/broadcast";
import { compareAndSet } from "@/lib/collab/draft";
import { createProjectRecord, getProject, updateProjectRecord } from "@/lib/projects";
import { safeNextPath } from "@/lib/utils";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function login(input: { email: string; password: string; next?: string }) {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter the email and password for a demo account." };

  const user = getUserByEmail(parsed.data.email);
  if (!user || !compareSync(parsed.data.password, user.passwordHash)) {
    return { error: "Those credentials do not match a Forma account." };
  }

  await setSession(user.id);
  redirect(safeNextPath(parsed.data.next));
}

export async function logout() {
  await clearSession();
  redirect("/");
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  template: z.enum(PROJECT_TEMPLATES),
});

const TEMPLATE_GOALS: Record<ProjectTemplate, string> = {
  blank: "",
  taskflow: TASKFLOW_GOAL,
  meetings: MEETINGS_GOAL,
  slotguard: SLOTGUARD_GOAL,
};

export async function createProject(input: { name: string; template: ProjectTemplate }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Give the workspace a name." };

  const id = crypto.randomUUID();
  createProjectRecord({
    id,
    name: parsed.data.name,
    ownerId: user.id,
    roomId: `forma-${id}`,
    template: parsed.data.template,
    goal: TEMPLATE_GOALS[parsed.data.template],
  });
  redirect(`/w/${id}`);
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  goal: z.string().max(2000).optional(),
  expectedGoal: z.string().max(2000).optional(),
});

export async function updateProject(input: { id: string; name?: string; goal?: string; expectedGoal?: string }) {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to edit this workspace." };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "That workspace name is not valid." };
  const project = getProject(parsed.data.id);
  if (!project) return { error: "This workspace no longer exists." };
  const goalWrite =
    parsed.data.goal === undefined ? "unchanged" : compareAndSet(project.goal, parsed.data.expectedGoal, parsed.data.goal);
  if (goalWrite === "conflict") return { conflict: true as const, goal: project.goal };
  const next = updateProjectRecord(project.id, {
    name: parsed.data.name,
    goal: goalWrite === "write" ? parsed.data.goal : undefined,
  });
  if (next && goalWrite === "write") {
    await publishResourceUpdate({
      roomId: project.roomId,
      resource: "goal",
      actorId: user.id,
      actorName: user.name,
      summary: `${user.name} updated the project goal`,
    });
  }
  return { ok: true as const, goal: next?.goal ?? project.goal };
}
