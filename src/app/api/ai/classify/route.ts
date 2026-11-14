import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { decide } from "@/lib/ai/decision";
import { geminiAllowed, geminiApiKey, loadArchitect } from "@/lib/ai/provider";
import { getProject } from "@/lib/projects";

const requestSchema = z.object({
  projectId: z.string().min(1),
  question: z.string().trim().min(1).max(2000),
  projectGoal: z.string().max(2000),
  blockTitles: z.array(z.string().max(160)).max(60),
  canvasEmpty: z.boolean().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to ask the architect." }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That question could not be routed." }, { status: 400 });
  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  const loaded = loadArchitect();
  const result = await decide({
    input: {
      question: parsed.data.question,
      goal: parsed.data.projectGoal || project.goal,
      blockTitles: parsed.data.blockTitles,
      canvasEmpty: parsed.data.canvasEmpty ?? parsed.data.blockTitles.length === 0,
    },
    geminiKey: geminiAllowed() ? geminiApiKey() : "",
    architect: "architect" in loaded ? loaded.architect : null,
  });
  return Response.json(result);
}
