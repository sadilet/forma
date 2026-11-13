import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { ARCHITECT_RULES } from "@/lib/ai/openai";
import { loadArchitect } from "@/lib/ai/provider";
import { describeCanvas, describeSpecification } from "@/lib/ai/prompt";
import { canvasSnapshotSchema, specificationSchema } from "@/lib/ai/schemas";
import { BLOCK_KINDS, BLOCK_META } from "@/lib/canvas/kinds";
import { getProject } from "@/lib/projects";

const requestSchema = z.object({
  projectId: z.string().min(1),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
  block: z.object({
    id: z.string(),
    kind: z.enum(BLOCK_KINDS),
    title: z.string(),
    description: z.string(),
  }),
  specification: specificationSchema.nullable(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to propose a specification." }, { status: 401 });

  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "This component could not be specified." }, { status: 400 });
  const project = getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  const block = parsed.data.block;

  try {
    const specification = await loaded.architect.completeJson({
      schema: specificationSchema,
      schemaName: "component_specification",
      system: ARCHITECT_RULES,
      temperature: 0.4,
      prompt: `Propose a specification for the selected component. Keep details that are already true. Fill gaps with explicit proposals, and put anything still undecided into open questions.
Do not claim the proposal has been saved.

Project: ${project.name}
Goal: ${parsed.data.projectGoal || project.goal || "Not stated."}
Component: ${block.title} (${BLOCK_META[block.kind].label})
Canvas description: ${block.description || "None."}

Current specification:
${describeSpecification(parsed.data.specification)}

${describeCanvas(parsed.data.canvas)}`,
    });
    return Response.json(specification);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The architect could not draft a specification.";
    return Response.json({ error: message }, { status: 502 });
  }
}
