import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";

const querySchema = z.object({
  projectId: z.string().min(1),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to read this workspace." }, { status: 401 });
  const parsed = querySchema.safeParse({ projectId: new URL(request.url).searchParams.get("projectId") });
  if (!parsed.success) return Response.json({ error: "Missing workspace." }, { status: 400 });
  const project = getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  return Response.json({ goal: project.goal });
}
