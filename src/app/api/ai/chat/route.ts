import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { ARCHITECT_RULES } from "@/lib/ai/openai";
import { loadArchitect, textStreamResponse } from "@/lib/ai/provider";
import { describeCanvas, describeSpecification } from "@/lib/ai/prompt";
import { canvasSnapshotSchema, specificationSchema } from "@/lib/ai/schemas";
import { BLOCK_KINDS, BLOCK_META, type BlockKind } from "@/lib/canvas/kinds";
import { getProject } from "@/lib/projects";
import { researchPrompt } from "@/lib/research/prompt-context";

const requestSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(["global", "local", "market", "leads"]),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
  block: z
    .object({
      id: z.string(),
      kind: z.enum(BLOCK_KINDS),
      title: z.string(),
      description: z.string(),
    })
    .nullable(),
  specification: specificationSchema.nullable(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(24),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to talk with the architect." }, { status: 401 });

  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That message could not be sent." }, { status: 400 });
  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  const focus = localFocus(parsed.data.block, parsed.data.specification);
  const system = [
    ARCHITECT_RULES,
    "",
    "Answer the latest question in concise prose. Use short lists when they make requirements or edge cases easier to scan.",
    "If the team has not decided something, say so and offer a question they should answer. Do not dump a full specification unless they ask for one.",
    "When a follow-up settles a product, market, or customer decision, say which canvas block should change and what its description should say. The team confirms the edit. Do not claim the canvas already changed.",
    "Use citation ids from the saved research when you state a market or lead fact. Do not invent sources.",
    "",
    "Project",
    project.name,
    "",
    "Goal",
    parsed.data.projectGoal || project.goal || "Not stated.",
    "",
    "Mode",
    parsed.data.mode,
    "",
    focus,
    "",
    describeCanvas(parsed.data.canvas),
    "",
    await researchPrompt(project.id, parsed.data.mode),
  ].join("\n");

  try {
    const chunks = await loaded.architect.streamText({
      system,
      temperature: 0.5,
      messages: parsed.data.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
    return textStreamResponse(chunks);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The architect could not respond.";
    return Response.json({ error: message }, { status: 502 });
  }
}

function localFocus(
  block: { kind: BlockKind; title: string; description: string } | null,
  specification: z.infer<typeof specificationSchema> | null,
) {
  if (!block) return "Selected component\nNone.";
  return [
    "Selected component",
    `${block.title} (${BLOCK_META[block.kind].label})`,
    "",
    "Description",
    block.description.trim() || "None.",
    "",
    "Saved specification",
    describeSpecification(specification),
  ].join("\n");
}
