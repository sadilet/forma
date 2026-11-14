import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadArchitect } from "@/lib/ai/provider";
import { canvasSnapshotSchema } from "@/lib/ai/schemas";
import { publishResourceUpdate } from "@/lib/collab/broadcast";
import { getResearchSource } from "@/lib/context-dev/client";
import { getProject } from "@/lib/projects";
import { inputHash } from "@/lib/research/hash";
import { draftLeadBrief, runLeadResearch } from "@/lib/research/leads";
import { ResearchFailure } from "@/lib/research/failure";
import { inferLocale, localeFromFields } from "@/lib/research/locale";
import { claimRun, finishRun } from "@/lib/research/lock";
import { LEAD_STATUSES, leadBriefSchema } from "@/lib/research/schemas";
import { latestResearchArtifact, listLeads, replaceLeads, saveResearchArtifact, updateLeadStatus, type LeadRecord } from "@/lib/records";

export const maxDuration = 180;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to read leads." }, { status: 401 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const project = await getProject(projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  const leads = await listLeads(projectId);
  if (url.searchParams.get("format") === "csv") {
    return new Response(leadsToCsv(leads), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-leads.csv"`,
      },
    });
  }
  return Response.json({ leads, session: await latestResearchArtifact(projectId, "leads") });
}

const runSchema = z.object({
  projectId: z.string().min(1),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
  brief: leadBriefSchema,
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to find leads." }, { status: 401 });
  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });
  const source = getResearchSource();
  if (!source) {
    return Response.json(
      { error: "Context.dev is not configured. Add CONTEXT_DEV_API_KEY to .env.local and restart the server." },
      { status: 503 },
    );
  }
  const parsed = runSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The lead request was not valid." }, { status: 400 });
  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  const locale = localeFromFields(parsed.data.brief.city, parsed.data.brief.country);
  if (!locale.city || !locale.country) {
    return Response.json({ error: "Add a city and country before finding leads." }, { status: 400 });
  }
  const key = `${project.id}:leads`;
  if (!claimRun(key)) return Response.json({ error: "Lead research is already running for this workspace." }, { status: 409 });
  try {
    const result = await runLeadResearch({
      source,
      architect: loaded.architect,
      projectName: project.name,
      goal: parsed.data.projectGoal || project.goal,
      canvas: parsed.data.canvas,
      brief: { ...parsed.data.brief, city: locale.city, country: locale.country },
      locale,
    });
    await replaceLeads(project.id, result.leads);
    const session = await saveResearchArtifact({
      projectId: project.id,
      kind: "leads",
      title: "Lead research",
      inputHash: inputHash({ brief: parsed.data.brief, blocks: parsed.data.canvas.blocks }),
      queryMeta: result.queryMeta,
      content: { brief: parsed.data.brief, proposals: result.proposals },
      citations: result.citations,
      createdBy: user.id,
    });
    await publishResourceUpdate({
      roomId: project.roomId,
      resource: "leads",
      actorId: user.id,
      actorName: user.name,
      summary: `${user.name} found ${result.leads.length} leads`,
    });
    return Response.json({ leads: result.leads, session });
  } catch (error) {
    const failure = error instanceof ResearchFailure ? error : null;
    const message = failure?.message ?? (error instanceof Error ? error.message : "Lead research failed.");
    return Response.json({ error: message }, { status: failure?.status ?? 502 });
  } finally {
    finishRun(key);
  }
}

const patchSchema = z.object({
  projectId: z.string().min(1),
  leadId: z.string().min(1),
  status: z.enum(LEAD_STATUSES),
});

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to update a lead." }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That lead update was not valid." }, { status: 400 });
  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  const lead = await updateLeadStatus(project.id, parsed.data.leadId, parsed.data.status);
  if (!lead) return Response.json({ error: "That lead is no longer on the list." }, { status: 404 });
  await publishResourceUpdate({
    roomId: project.roomId,
    resource: "leads",
    actorId: user.id,
    actorName: user.name,
    summary: `${user.name} marked ${lead.personName} as ${lead.status}`,
  });
  return Response.json({ lead });
}

const briefSchema = z.object({
  projectId: z.string().min(1),
  projectGoal: z.string().max(2000),
  canvas: canvasSnapshotSchema,
});

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to draft a lead brief." }, { status: 401 });
  const loaded = loadArchitect();
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 503 });
  const parsed = briefSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The canvas snapshot was not valid." }, { status: 400 });
  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });
  const text = [
    parsed.data.projectGoal,
    ...parsed.data.canvas.blocks.map((block) => `${block.title} ${block.description}`),
  ].join("\n");
  const locale = inferLocale(text);
  const brief = await draftLeadBrief({
    architect: loaded.architect,
    goal: parsed.data.projectGoal || project.goal,
    canvas: parsed.data.canvas,
    locale,
  });
  return Response.json({ brief, locale });
}

function leadsToCsv(leads: LeadRecord[]) {
  const header = [
    "name",
    "role",
    "seniority",
    "company",
    "domain",
    "location",
    "profiles",
    "skills",
    "confidence",
    "warm_trigger",
    "outreach_angle",
    "status",
  ];
  const lines = leads.map((lead) =>
    [
      lead.personName,
      lead.roleTitle,
      lead.seniority,
      lead.companyName,
      lead.companyDomain,
      lead.location,
      lead.profileUrls.join(" "),
      lead.skills.join(" "),
      lead.matchConfidence ?? "",
      lead.warmTrigger,
      lead.outreachAngle,
      lead.status,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string | number) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
