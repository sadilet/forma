import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadArchitect } from "@/lib/ai/provider";
import { canvasSnapshotSchema } from "@/lib/ai/schemas";
import { publishResourceUpdate } from "@/lib/collab/broadcast";
import { getResearchSource } from "@/lib/context-dev/client";
import { getProject } from "@/lib/projects";
import { inputHash } from "@/lib/research/hash";
import { localeFromFields } from "@/lib/research/locale";
import { runMarketResearch } from "@/lib/research/market";
import { ResearchFailure } from "@/lib/research/failure";
import { claimRun, finishRun } from "@/lib/research/lock";
import { latestResearchArtifact, saveResearchArtifact } from "@/lib/records";

export const maxDuration = 180;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to read market research." }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!getProject(projectId)) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  return Response.json({ report: latestResearchArtifact(projectId, "market") });
}

const bodySchema = z.object({
  projectId: z.string().min(1),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
  city: z.string().max(80),
  country: z.string().max(80),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to run market research." }, { status: 401 });
  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });
  const source = getResearchSource();
  if (!source) {
    return Response.json(
      { error: "Context.dev is not configured. Add CONTEXT_DEV_API_KEY to .env.local and restart the server." },
      { status: 503 },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The market request was not valid." }, { status: 400 });
  const project = getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  const locale = localeFromFields(parsed.data.city, parsed.data.country);
  if (!locale.city || !locale.country) {
    return Response.json({ error: "Add a city and country before running market research." }, { status: 400 });
  }
  const key = `${project.id}:market`;
  if (!claimRun(key)) {
    return Response.json({ error: "Market research is already running for this workspace." }, { status: 409 });
  }
  try {
    const result = await runMarketResearch({
      source,
      architect: loaded.architect,
      projectName: project.name,
      goal: parsed.data.projectGoal || project.goal,
      canvas: parsed.data.canvas,
      locale,
    });
    const stored = saveResearchArtifact({
      projectId: project.id,
      kind: "market",
      title: "Market research",
      inputHash: inputHash({
        goal: parsed.data.projectGoal || project.goal,
        locale,
        blocks: parsed.data.canvas.blocks,
      }),
      queryMeta: result.queryMeta,
      content: result.report,
      citations: result.citations,
      createdBy: user.id,
    });
    await publishResourceUpdate({
      roomId: project.roomId,
      resource: "market",
      actorId: user.id,
      actorName: user.name,
      summary: `${user.name} ran market research`,
    });
    return Response.json({ report: stored });
  } catch (error) {
    const failure = error instanceof ResearchFailure ? error : null;
    const message = failure?.message ?? (error instanceof Error ? error.message : "Market research failed.");
    return Response.json({ error: message }, { status: failure?.status ?? 502 });
  } finally {
    finishRun(key);
  }
}
