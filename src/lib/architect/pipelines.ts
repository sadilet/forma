import type { CanvasSnapshot } from "@/lib/ai/schemas";
import { researchPlace } from "@/lib/research/locale";
import type { ArchitectTab } from "@/lib/architect/tabs";

// What a tab needs before it can answer well, and how to produce it. These run in the browser, from the chat bar,
// against the same routes the tab buttons use. Every function returns instead of throwing, so one missing
// source (for example no Context.dev key) never stops the answer.

export type PipelineContext = {
  projectId: string;
  goal: string;
  canvas: CanvasSnapshot;
};

export type PipelineResource = "analysis" | "market" | "leads" | "docs" | "standards";

export type PipelineResult = {
  // Which saved resources changed, so the open tab can reload.
  changed: PipelineResource[];
  // One line the feed shows when something could not run. Null when everything did.
  notice: string | null;
};

const EXTERNAL_OFF =
  "Live web lookup is off, so this answer comes from the canvas. Add CONTEXT_DEV_API_KEY to turn it on.";

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorOf(data: Record<string, unknown>, fallback: string) {
  return typeof data.error === "string" ? data.error : fallback;
}

function post(url: string, body: unknown, method = "POST") {
  return fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// Does this tab already hold something to answer from?
export async function hasArtifact(tab: ArchitectTab, projectId: string): Promise<boolean> {
  const query = `projectId=${encodeURIComponent(projectId)}`;
  try {
    if (tab === "review") {
      const data = await readJson(await fetch(`/api/ai/analyze?${query}`));
      return Boolean(data.analysis);
    }
    if (tab === "market") {
      const data = await readJson(await fetch(`/api/ai/research/market?${query}`));
      return Boolean(data.report);
    }
    if (tab === "leads") {
      const data = await readJson(await fetch(`/api/ai/research/leads?${query}`));
      return Array.isArray(data.leads) && data.leads.length > 0;
    }
    const [docs, standards] = await Promise.all([
      fetch(`/api/build/grounding/docs?${query}`).then(readJson),
      fetch(`/api/build/grounding/standards?${query}`).then(readJson),
    ]);
    return Boolean(docs.pack) && Boolean(standards.pack);
  } catch {
    // If we cannot tell, assume it is missing. Running is safe and answering without it is not.
    return false;
  }
}

export function pipelineLabel(tab: ArchitectTab) {
  if (tab === "review") return "Reviewing the canvas";
  if (tab === "market") return "Researching the market";
  if (tab === "leads") return "Finding leads";
  return "Reading the docs and standards that apply";
}

export async function runPipeline(tab: ArchitectTab, context: PipelineContext): Promise<PipelineResult> {
  try {
    if (tab === "review") return await runReview(context);
    if (tab === "market") return await runMarket(context);
    if (tab === "leads") return await runLeads(context);
    return await runEngineering(context);
  } catch (caught) {
    return { changed: [], notice: caught instanceof Error ? caught.message : "That step could not run." };
  }
}

function failure(response: Response, data: Record<string, unknown>, fallback: string): PipelineResult {
  // 503 from a research route means the web source is not configured. Say so plainly and answer anyway.
  if (response.status === 503 && /context\.dev/i.test(errorOf(data, ""))) return { changed: [], notice: EXTERNAL_OFF };
  // 409 means somebody else is already running it. Their result will land through the room.
  if (response.status === 409) return { changed: [], notice: null };
  return { changed: [], notice: errorOf(data, fallback) };
}

async function runReview(context: PipelineContext): Promise<PipelineResult> {
  const response = await post("/api/ai/analyze", {
    projectId: context.projectId,
    projectGoal: context.goal,
    canvas: context.canvas,
  });
  const data = await readJson(response);
  if (!response.ok) return failure(response, data, "The canvas review could not run.");
  return { changed: ["analysis"], notice: null };
}

function placeText(context: PipelineContext) {
  return [context.goal, ...context.canvas.blocks.map((block) => `${block.title} ${block.description}`)].join("\n");
}

async function runMarket(context: PipelineContext): Promise<PipelineResult> {
  const place = researchPlace(placeText(context));
  const response = await post("/api/ai/research/market", {
    projectId: context.projectId,
    projectGoal: context.goal,
    canvas: context.canvas,
    city: place.city,
    country: place.country,
  });
  const data = await readJson(response);
  if (!response.ok) return failure(response, data, "Market research could not run.");
  return { changed: ["market"], notice: null };
}

async function runLeads(context: PipelineContext): Promise<PipelineResult> {
  const drafted = await post(
    "/api/ai/research/leads",
    { projectId: context.projectId, projectGoal: context.goal, canvas: context.canvas },
    "PUT",
  );
  const draftData = await readJson(drafted);
  if (!drafted.ok) return failure(drafted, draftData, "The lead brief could not be drafted.");
  const brief = draftData.brief as Record<string, unknown> | undefined;
  if (!brief) return { changed: [], notice: "The lead brief could not be drafted." };
  const place = researchPlace(placeText(context));
  const response = await post("/api/ai/research/leads", {
    projectId: context.projectId,
    projectGoal: context.goal,
    canvas: context.canvas,
    brief: {
      ...brief,
      city: typeof brief.city === "string" && brief.city.trim() ? brief.city : place.city,
      country: typeof brief.country === "string" && brief.country.trim() ? brief.country : place.country,
    },
  });
  const data = await readJson(response);
  if (!response.ok) return failure(response, data, "Lead research could not run.");
  return { changed: ["leads"], notice: null };
}

async function runEngineering(context: PipelineContext): Promise<PipelineResult> {
  const body = { projectId: context.projectId, projectGoal: context.goal, canvas: context.canvas };
  const [docs, standards] = await Promise.all(
    (["docs", "standards"] as const).map(async (kind) => {
      const response = await post(`/api/build/grounding/${kind}`, body);
      return { kind, response, data: await readJson(response) };
    }),
  );
  const changed: PipelineResource[] = [];
  let notice: string | null = null;
  for (const result of [docs, standards]) {
    if (result.response.ok) {
      changed.push(result.kind);
      continue;
    }
    notice ??= failure(result.response, result.data, "The engineering lookup could not run.").notice;
  }
  return { changed, notice };
}
