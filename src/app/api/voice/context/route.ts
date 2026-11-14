import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { CONTEXT_SCOPES } from "@/lib/voice/protocol";
import { buildWorkspaceContext } from "@/lib/voice/context";

const bodySchema = z.object({
  projectId: z.string().min(1),
  scope: z.enum(CONTEXT_SCOPES),
  blockId: z.string().max(200).optional(),
});

// Called when Gemini Live runs get_workspace_context. Read-only.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to read this workspace." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That context request was not valid." }, { status: 400 });
  if (!(await getProject(parsed.data.projectId))) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  return Response.json({
    context: await buildWorkspaceContext(parsed.data.projectId, parsed.data.scope, parsed.data.blockId),
  });
}
