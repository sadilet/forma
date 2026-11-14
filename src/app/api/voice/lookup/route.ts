import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { liveLookup } from "@/lib/voice/lookup";
import { isLookupKind, LOOKUP_KINDS } from "@/lib/voice/protocol";

export const maxDuration = 60;

const bodySchema = z.object({
  projectId: z.string().min(1),
  question: z.string().min(1).max(400),
  kind: z.enum(LOOKUP_KINDS).optional(),
});

// Called when Gemini Live runs lookup_web. Keeps the Context.dev key on the server.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to run a live lookup." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That lookup request was not valid." }, { status: 400 });
  if (!(await getProject(parsed.data.projectId))) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  const kind = parsed.data.kind && isLookupKind(parsed.data.kind) ? parsed.data.kind : "answer";
  const result = await liveLookup(parsed.data.question, kind);
  return Response.json({ result });
}
