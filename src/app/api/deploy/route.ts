import { z } from "zod";
import { canvasSnapshotSchema } from "@/lib/ai/schemas";
import { getCurrentUser } from "@/lib/auth";
import { deployTemplateFor } from "@/lib/deploy/contract";
import { serviceNameFor } from "@/lib/deploy/names";
import { enqueueJob, latestJobForProject, listEvents } from "@/lib/deploy/queue";
import { getWebDeployDb } from "@/lib/deploy/web";
import { getProject } from "@/lib/projects";

// The web side of deploy. It only puts a job in the queue and reports on it.
// The worker (npm run deploy:worker) does the building and shipping.

const startSchema = z.object({
  projectId: z.string().min(1),
  canvas: canvasSnapshotSchema,
});

const statusSchema = z.object({
  projectId: z.string().min(1),
  jobId: z.string().optional(),
  after: z.coerce.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to deploy." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request was not valid JSON." }, { status: 400 });
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Send the workspace and its canvas." }, { status: 400 });

  const project = getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  const template = deployTemplateFor(project.template);
  if (!template) {
    return Response.json(
      { error: "Only the SlotGuard demo can be deployed so far. Other workspaces need the app builder, which is not ready." },
      { status: 422 },
    );
  }

  const { job, created } = enqueueJob(getWebDeployDb(), {
    projectId: project.id,
    requestedBy: user.id,
    template,
    serviceName: serviceNameFor(project.id),
    snapshot: parsed.data.canvas,
    goal: project.goal,
  });
  return Response.json({ job, created }, { status: created ? 202 : 200 });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to see deploys." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const parsed = statusSchema.safeParse({
    projectId: params.get("projectId"),
    jobId: params.get("jobId") || undefined,
    after: params.get("after") ?? 0,
  });
  if (!parsed.success) return Response.json({ error: "Missing workspace." }, { status: 400 });
  if (!getProject(parsed.data.projectId)) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  const db = getWebDeployDb();
  const job = latestJobForProject(db, parsed.data.projectId);
  if (!job) return Response.json({ job: null, events: [], reset: true, serverTime: Date.now() });

  // `after` only means something for the job the browser already knows. For a newer job, start from the top.
  const known = parsed.data.jobId === job.id;
  const events = listEvents(db, job.id, known ? parsed.data.after : 0);
  return Response.json({ job, events, reset: !known, serverTime: Date.now() });
}
