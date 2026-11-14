import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { ARCHITECT_RULES } from "@/lib/ai/openai";
import { loadArchitect } from "@/lib/ai/provider";
import { describeCanvas } from "@/lib/ai/prompt";
import { analysisSchema, canvasSnapshotSchema } from "@/lib/ai/schemas";
import { publishResourceUpdate } from "@/lib/collab/broadcast";
import { getProject } from "@/lib/projects";
import { acceptProposals } from "@/lib/research/proposals";
import { latestAnalysis, saveAnalysis } from "@/lib/records";

const requestSchema = z.object({
  projectId: z.string().min(1),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to read the canvas review." }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!projectId || !await getProject(projectId)) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  return Response.json({ analysis: await latestAnalysis(projectId) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to analyze the canvas." }, { status: 401 });

  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The canvas snapshot was not valid." }, { status: 400 });

  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  try {
    const drafted = await loaded.architect.completeJson({
      schema: analysisSchema,
      schemaName: "canvas_analysis",
      system: ARCHITECT_RULES,
      temperature: 0.4,
      prompt: `Review this product canvas. Return 4 to 7 findings a team should discuss before building.
Each finding must name a real product gap: a missing user flow, an unsettled decision, ambiguous product logic, or an edge case such as a cancellation, a failure, or a person who should not be able to do something.
relatedBlockId must be one of the component ids below, or null if the gap is about something that is not on the canvas.
Also return canvasProposals. Each proposal replaces a decision or note description, or creates one, so the conclusion lives on the canvas. Use an empty array when the review should not change the canvas yet.
The team confirms every canvas change.

Project: ${project.name}
Goal: ${parsed.data.projectGoal || project.goal || "Not stated."}

${describeCanvas(parsed.data.canvas)}`,
    });
    const analysis = {
      ...drafted,
      canvasProposals: acceptProposals({
        proposals: drafted.canvasProposals,
        canvas: parsed.data.canvas,
        citationIds: new Set(),
        scope: "conclusions",
      }),
    };
    const stored = await saveAnalysis({ projectId: project.id, analysis, createdBy: user.id });
    await publishResourceUpdate({
      roomId: project.roomId,
      resource: "analysis",
      actorId: user.id,
      actorName: user.name,
      summary: `${user.name} ran a canvas review`,
    });
    return Response.json({ analysis: stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The architect could not read the canvas.";
    return Response.json({ error: message }, { status: 502 });
  }
}
