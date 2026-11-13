import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { chatMessageSchema } from "@/lib/ai/schemas";
import { getConversation, getProject, saveConversation } from "@/lib/projects";

const querySchema = z.object({
  projectId: z.string().min(1),
  blockId: z.string(),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to read this conversation." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    blockId: url.searchParams.get("blockId") ?? "",
  });
  if (!parsed.success) return Response.json({ error: "Missing conversation." }, { status: 400 });
  if (!getProject(parsed.data.projectId)) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  return Response.json({ messages: getConversation(parsed.data.projectId, parsed.data.blockId) });
}

const putSchema = z.object({
  projectId: z.string().min(1),
  blockId: z.string(),
  messages: z.array(chatMessageSchema).max(40),
});

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to save this conversation." }, { status: 401 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That conversation is not valid." }, { status: 400 });
  if (!getProject(parsed.data.projectId)) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  saveConversation(parsed.data.projectId, parsed.data.blockId, parsed.data.messages);
  return Response.json({ ok: true });
}
