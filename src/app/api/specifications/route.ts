import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { specificationSchema } from "@/lib/ai/schemas";
import { getProject, getSpecification, saveSpecification } from "@/lib/projects";

const querySchema = z.object({
  projectId: z.string().min(1),
  blockId: z.string().min(1),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to read specifications." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    blockId: url.searchParams.get("blockId"),
  });
  if (!parsed.success) return Response.json({ error: "Missing component." }, { status: 400 });
  if (!getProject(parsed.data.projectId)) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  return Response.json({ specification: getSpecification(parsed.data.projectId, parsed.data.blockId) });
}

const putSchema = querySchema.extend({
  specification: specificationSchema,
});

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to save a specification." }, { status: 401 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That specification is not valid." }, { status: 400 });
  if (!getProject(parsed.data.projectId)) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  saveSpecification(parsed.data.projectId, parsed.data.blockId, parsed.data.specification);
  return Response.json({ ok: true });
}
