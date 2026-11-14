import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { specificationSchema } from "@/lib/ai/schemas";
import { publishResourceUpdate } from "@/lib/collab/broadcast";
import { getProject, getSpecificationRecord, writeSpecification } from "@/lib/projects";

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
  const record = getSpecificationRecord(parsed.data.projectId, parsed.data.blockId);
  return Response.json(record);
}

const putSchema = querySchema.extend({
  specification: specificationSchema,
  expectedUpdatedAt: z.number().nullable(),
});

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to save a specification." }, { status: 401 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That specification is not valid." }, { status: 400 });
  const project = getProject(parsed.data.projectId);
  if (!project) {
    return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  }
  const written = writeSpecification(
    parsed.data.projectId,
    parsed.data.blockId,
    parsed.data.specification,
    parsed.data.expectedUpdatedAt,
  );
  if (written.conflict) {
    return Response.json(
      {
        error: "Someone else saved this specification. Load the saved version before saving again.",
        specification: written.specification,
        updatedAt: written.updatedAt,
      },
      { status: 409 },
    );
  }
  await publishResourceUpdate({
    roomId: project.roomId,
    resource: "specification",
    blockId: parsed.data.blockId,
    actorId: user.id,
    actorName: user.name,
    summary: `${user.name} saved a specification`,
  });
  return Response.json({ ok: true, updatedAt: written.updatedAt });
}
