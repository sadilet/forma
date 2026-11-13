import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { ARCHITECT_RULES } from "@/lib/ai/openai";
import { loadArchitect } from "@/lib/ai/provider";
import { describeCanvas } from "@/lib/ai/prompt";
import { analysisSchema, canvasSnapshotSchema } from "@/lib/ai/schemas";
import { getProject } from "@/lib/projects";

const requestSchema = z.object({
  projectId: z.string().min(1),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to analyze the canvas." }, { status: 401 });

  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The canvas snapshot was not valid." }, { status: 400 });

  const project = getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  try {
    const analysis = await loaded.architect.completeJson({
      schema: analysisSchema,
      schemaName: "canvas_analysis",
      system: ARCHITECT_RULES,
      temperature: 0.4,
      prompt: `Review this product canvas. Return 4 to 7 findings a team should discuss before building.
Each finding must name a real gap: a missing requirement, an incomplete flow, ambiguous business logic, a missing component, or an architectural risk.
relatedBlockId must be one of the component ids below, or null if the gap is about something that is not on the canvas.
relatedBlockTitle should match that component, or null.

Project: ${project.name}
Goal: ${parsed.data.projectGoal || project.goal || "Not stated."}

${describeCanvas(parsed.data.canvas)}`,
    });
    return Response.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The architect could not read the canvas.";
    return Response.json({ error: message }, { status: 502 });
  }
}
