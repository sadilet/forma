import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadArchitect } from "@/lib/ai/provider";
import { draftScaffold } from "@/lib/canvas/scaffold";
import { getProject, updateProjectRecord } from "@/lib/projects";

export const maxDuration = 60;

const bodySchema = z.object({
  projectId: z.string().min(1),
  brief: z.string().trim().min(1).max(2000),
  // When true, the browser will clear the page before placing blocks. The API still drafts either way.
  replace: z.boolean().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to draft a canvas." }, { status: 401 });

  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That scaffold request was not valid." }, { status: 400 });

  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  try {
    const plan = await draftScaffold({
      architect: loaded.architect,
      brief: parsed.data.brief,
      projectName: project.name,
      currentGoal: project.goal,
    });
    // Seed the workspace goal when it was empty, so Review and research start from the same brief.
    if (!project.goal.trim() && plan.goal.trim()) {
      await updateProjectRecord(project.id, { goal: plan.goal });
    }
    return Response.json({ plan, replace: Boolean(parsed.data.replace) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not draft that canvas.";
    return Response.json({ error: message }, { status: 502 });
  }
}
