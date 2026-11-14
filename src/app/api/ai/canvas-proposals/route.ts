import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadArchitect } from "@/lib/ai/provider";
import { canvasProposalSchema, canvasSnapshotSchema } from "@/lib/ai/schemas";
import { BLOCK_KINDS } from "@/lib/canvas/kinds";
import { getProject } from "@/lib/projects";
import { acceptProposals } from "@/lib/research/proposals";
import { researchPrompt } from "@/lib/research/prompt-context";
import { latestResearchArtifact } from "@/lib/records";

const bodySchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(["global", "local", "market", "leads"]),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
  message: z.string().min(1).max(8000),
  block: z
    .object({
      id: z.string(),
      kind: z.enum(BLOCK_KINDS),
      title: z.string(),
      description: z.string(),
    })
    .nullable(),
});

const proposalListSchema = z.object({
  proposals: z.array(canvasProposalSchema).max(4),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to propose a canvas change." }, { status: 401 });
  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That proposal request was not valid." }, { status: 400 });
  const project = getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  const citations = citationsFor(project.id, parsed.data.mode);
  const citationIds = new Set(citations.map((citation) => citation.id));
  try {
    const drafted = await loaded.architect.completeJson({
      schema: proposalListSchema,
      schemaName: "canvas_proposals",
      temperature: 0.2,
      system: [
        "Turn the latest recommendation into canvas edits.",
        "The canvas is what Build will read. A decision or note description should hold the conclusion.",
        "Update an existing decision or note when one already covers the topic. Create one only when the canvas has nowhere to put the conclusion.",
        "For a selected component, update only that component's description.",
        "Use citation ids only when the recommendation is tied to a retrieved source. An empty citation list is allowed for a choice the team just made.",
        "Return an empty proposals array when the message does not ask the canvas to change.",
      ].join(" "),
      prompt: [
        `Project: ${project.name}`,
        `Goal: ${parsed.data.projectGoal || project.goal || "Not stated."}`,
        `Mode: ${parsed.data.mode}`,
        parsed.data.block ? `Selected component: ${parsed.data.block.title} [${parsed.data.block.id}]` : "",
        "",
        researchPrompt(project.id, parsed.data.mode),
        "",
        "Recommendation",
        parsed.data.message,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return Response.json({
      proposals: acceptProposals({
        proposals: drafted.proposals,
        canvas: parsed.data.canvas,
        citationIds,
        scope: parsed.data.mode === "local" ? "block" : "conclusions",
        focusBlockId: parsed.data.block?.id,
      }),
      citations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A canvas proposal could not be drafted.";
    return Response.json({ error: message }, { status: 502 });
  }
}

function citationsFor(projectId: string, mode: "global" | "local" | "market" | "leads") {
  if (mode !== "market" && mode !== "leads") return [];
  return latestResearchArtifact(projectId, mode)?.citations ?? [];
}