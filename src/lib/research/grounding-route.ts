import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadArchitect } from "@/lib/ai/provider";
import { canvasSnapshotSchema } from "@/lib/ai/schemas";
import { publishResourceUpdate } from "@/lib/collab/broadcast";
import { getResearchSource } from "@/lib/context-dev/client";
import { getProject } from "@/lib/projects";
import { inputHash } from "@/lib/research/hash";
import { ResearchFailure } from "@/lib/research/failure";
import { runDocsGrounding, runStandardsGrounding } from "@/lib/research/grounding";
import { claimRun, finishRun } from "@/lib/research/lock";
import { latestResearchArtifact, saveResearchArtifact } from "@/lib/records";
import type { ResearchKind } from "@/lib/research/schemas";

export const maxDuration = 180;

const bodySchema = z.object({
  projectId: z.string().min(1),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
});

export function groundingHandlers(kind: Extract<ResearchKind, "docs" | "standards">) {
  return {
    async GET(request: Request) {
      const user = await getCurrentUser();
      if (!user) return Response.json({ error: "Sign in to read grounding." }, { status: 401 });
      const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
      if (!getProject(projectId)) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
      return Response.json({ pack: latestResearchArtifact(projectId, kind) });
    },
    async POST(request: Request) {
      const user = await getCurrentUser();
      if (!user) return Response.json({ error: "Sign in to ground this workspace." }, { status: 401 });
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
      if (!parsed.success) return Response.json({ error: "The grounding request was not valid." }, { status: 400 });
      const project = getProject(parsed.data.projectId);
      if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
      const key = `${project.id}:${kind}`;
      if (!claimRun(key)) return Response.json({ error: "That grounding run is already in progress." }, { status: 409 });
      try {
        const result =
          kind === "docs"
            ? await runDocsGrounding({
                source,
                architect: loaded.architect,
                projectName: project.name,
                goal: parsed.data.projectGoal || project.goal,
                canvas: parsed.data.canvas,
              })
            : await runStandardsGrounding({
                source,
                architect: loaded.architect,
                projectName: project.name,
                goal: parsed.data.projectGoal || project.goal,
                canvas: parsed.data.canvas,
              });
        const stored = saveResearchArtifact({
          projectId: project.id,
          kind,
          title: kind === "docs" ? "Documentation pack" : "Engineering standards",
          inputHash: inputHash({ goal: parsed.data.projectGoal || project.goal, blocks: parsed.data.canvas.blocks, kind }),
          queryMeta: result.queryMeta,
          content: result.pack,
          citations: result.citations,
          createdBy: user.id,
        });
        await publishResourceUpdate({
          roomId: project.roomId,
          resource: kind,
          actorId: user.id,
          actorName: user.name,
          summary: `${user.name} refreshed ${kind === "docs" ? "documentation" : "engineering standards"}`,
        });
        return Response.json({ pack: stored });
      } catch (error) {
        const failure = error instanceof ResearchFailure ? error : null;
        const message = failure?.message ?? (error instanceof Error ? error.message : "Grounding failed.");
        return Response.json({ error: message }, { status: failure?.status ?? 502 });
      } finally {
        finishRun(key);
      }
    },
  };
}
