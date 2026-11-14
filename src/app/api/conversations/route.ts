import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { chatMessageSchema } from "@/lib/ai/schemas";
import { publishResourceUpdate } from "@/lib/collab/broadcast";
import { getConversation, getProject, mergeConversation } from "@/lib/projects";

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
  if (!await getProject(parsed.data.projectId)) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  return Response.json({ messages: await getConversation(parsed.data.projectId, parsed.data.blockId) });
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
  const project = await getProject(parsed.data.projectId);
  if (!project) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  const messages = await mergeConversation(parsed.data.projectId, parsed.data.blockId, parsed.data.messages);
  await publishResourceUpdate({
    roomId: project.roomId,
    resource: "conversation",
    blockId: parsed.data.blockId,
    actorId: user.id,
    actorName: user.name,
    summary: `${user.name} continued a conversation`,
  });
  return Response.json({ messages });
}
