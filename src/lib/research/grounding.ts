import "server-only";

import type { Architect } from "@/lib/ai/provider";
import { describeCanvas } from "@/lib/ai/prompt";
import type { CanvasSnapshot } from "@/lib/ai/schemas";
import type { ResearchSource } from "@/lib/context-dev/source";
import { catalogFromHits, describeCitations, keepKnownIds, type Citation, type CitationHit } from "@/lib/research/citations";
import { ResearchFailure } from "@/lib/research/failure";
import {
  docPackSchema,
  stackPlanSchema,
  standardsPackSchema,
  surfacePlanSchema,
  type DocPack,
  type QueryMeta,
  type StandardsPack,
} from "@/lib/research/schemas";
import { settleList, settleText } from "@/lib/research/settle";

const DEFAULT_PACKAGES = [
  { packageName: "next", docsDomain: "nextjs.org", query: "Next.js App Router route handlers" },
  { packageName: "typescript", docsDomain: "typescriptlang.org", query: "TypeScript 5 strict types" },
];

export async function runDocsGrounding(input: {
  source: ResearchSource;
  architect: Architect;
  projectName: string;
  goal: string;
  canvas: CanvasSnapshot;
}): Promise<{ pack: DocPack; citations: Citation[]; queryMeta: QueryMeta }> {
  const failures: string[] = [];
  const packages = await inferPackages(input, failures);
  const hits: CitationHit[] = [];
  const pages: { packageName: string; url: string; markdown: string }[] = [];
  for (const item of packages) {
    const domain = item.docsDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const results = await settleList(
      input.source.searchWeb({
        query: item.query,
        includeDomains: domain ? [domain] : undefined,
        numResults: 2,
      }),
      failures,
      `Docs search for ${item.packageName} was unavailable.`,
    );
    const page = results[0];
    if (!page) continue;
    hits.push({ ...page, sourceKind: "docs" });
    const markdown = await settleText(
      input.source.scrapeMarkdown(page.url),
      failures,
      `Could not read docs for ${item.packageName}.`,
    );
    if (markdown) pages.push({ packageName: item.packageName, url: page.url, markdown });
  }
  const citations = catalogFromHits(hits);
  if (citations.length === 0) {
    throw new ResearchFailure("No official documentation pages could be retrieved for this canvas.", 502);
  }
  const known = new Set(citations.map((citation) => citation.id));
  const drafted = await input.architect.completeJson({
    schema: docPackSchema,
    schemaName: "doc_pack",
    temperature: 0.2,
    system:
      "Distill official documentation into a pack a coding agent can follow. Cite only the supplied source ids. Omit any package you cannot cite. Do not invent APIs.",
    prompt: [
      `Project: ${input.projectName}`,
      `Goal: ${input.goal}`,
      describeCanvas(input.canvas),
      "",
      "Sources",
      describeCitations(citations),
      "",
      ...pages.map((page) => `## ${page.packageName}\n${page.url}\n${page.markdown}`),
    ]
      .join("\n")
      .slice(0, 16_000),
  });
  const pack: DocPack = {
    summary: drafted.summary,
    packages: drafted.packages.flatMap((item) => {
      const citationIds = keepKnownIds(item.citationIds, known);
      if (citationIds.length === 0) return [];
      return [{ ...item, citationIds }];
    }),
  };
  if (pack.packages.length === 0) {
    throw new ResearchFailure("The documentation pages did not support a cited package pack.", 502);
  }
  return {
    pack,
    citations,
    queryMeta: { queries: packages.map((item) => item.query), failures, geography: "", assumedGeography: false },
  };
}

export async function runStandardsGrounding(input: {
  source: ResearchSource;
  architect: Architect;
  projectName: string;
  goal: string;
  canvas: CanvasSnapshot;
}): Promise<{ pack: StandardsPack; citations: Citation[]; queryMeta: QueryMeta }> {
  const failures: string[] = [];
  const surfaces = await inferSurfaces(input);
  const hits: CitationHit[] = [];
  const notes: string[] = [];
  for (const surface of surfaces) {
    const answer = await settleAnswer(input.source, surface.question, failures);
    for (const url of answer.sources) {
      hits.push({ title: surface.category, url, snippet: surface.question, sourceKind: "standard" });
    }
    notes.push(`${surface.category}: ${JSON.stringify(answer.json).slice(0, 1500)}`);
  }
  const citations = catalogFromHits(hits);
  if (citations.length === 0) {
    throw new ResearchFailure("No engineering standards could be retrieved for this canvas.", 502);
  }
  const known = new Set(citations.map((citation) => citation.id));
  const blockIds = new Set(input.canvas.blocks.map((block) => block.id));
  const drafted = await input.architect.completeJson({
    schema: standardsPackSchema,
    schemaName: "standards_pack",
    temperature: 0.2,
    system:
      "Turn retrieved engineering sources into invariants and a checklist mapped to canvas block ids. Cite only supplied source ids. Drop a rule you cannot cite.",
    prompt: [
      `Project: ${input.projectName}`,
      `Goal: ${input.goal}`,
      describeCanvas(input.canvas),
      "",
      "Sources",
      describeCitations(citations),
      "",
      "Retrieved answers",
      ...notes,
    ]
      .join("\n")
      .slice(0, 16_000),
  });
  const pack: StandardsPack = {
    summary: drafted.summary,
    standards: drafted.standards.flatMap((standard) => {
      const citationIds = keepKnownIds(standard.citationIds, known);
      const appliesToBlockIds = standard.appliesToBlockIds.filter((id) => blockIds.has(id));
      if (citationIds.length === 0 || appliesToBlockIds.length === 0) return [];
      return [{ ...standard, citationIds, appliesToBlockIds }];
    }),
  };
  if (pack.standards.length === 0) {
    throw new ResearchFailure("The retrieved standards did not map to a cited canvas block.", 502);
  }
  return {
    pack,
    citations,
    queryMeta: {
      queries: surfaces.map((surface) => surface.question),
      failures,
      geography: "",
      assumedGeography: false,
    },
  };
}

async function inferPackages(
  input: { architect: Architect; goal: string; canvas: CanvasSnapshot },
  failures: string[],
) {
  try {
    const drafted = await input.architect.completeJson({
      schema: stackPlanSchema,
      schemaName: "stack_plan",
      temperature: 0.1,
      system:
        "Infer the documentation hosts a team should read before building this canvas. Prefer official docs domains. Return at most five packages.",
      prompt: `Goal:\n${input.goal}\n\n${describeCanvas(input.canvas)}`,
    });
    const packages = drafted.packages
      .map((item) => ({
        packageName: item.packageName.trim(),
        docsDomain: item.docsDomain.trim(),
        query: item.query.trim(),
      }))
      .filter((item) => item.packageName && item.docsDomain && item.query);
    return packages.length > 0 ? packages : DEFAULT_PACKAGES;
  } catch {
    failures.push("The stack plan fell back to Next.js and TypeScript.");
    return DEFAULT_PACKAGES;
  }
}

async function inferSurfaces(input: { architect: Architect; goal: string; canvas: CanvasSnapshot }) {
  try {
    const drafted = await input.architect.completeJson({
      schema: surfacePlanSchema,
      schemaName: "surface_plan",
      temperature: 0.1,
      system:
        "Name the engineering surfaces on this canvas that need a cited standard: auth, payments, webhooks, idempotency, concurrency, or personal data. Use block ids from the canvas.",
      prompt: `Goal:\n${input.goal}\n\n${describeCanvas(input.canvas)}`,
    });
    const surfaces = drafted.surfaces.filter((surface) => surface.question.trim() && surface.category.trim());
    if (surfaces.length > 0) return surfaces;
  } catch {
    // The default surface below still retrieves a standard.
  }
  return [
    {
      category: "input validation",
      question: "Which input-validation and data-retention practices should a small web product follow?",
      blockIds: input.canvas.blocks.slice(0, 3).map((block) => block.id),
    },
  ];
}

async function settleAnswer(source: ResearchSource, question: string, failures: string[]) {
  try {
    return await source.answers({
      task: `${question} Use authoritative sources such as datatracker.ietf.org, cheatsheetseries.owasp.org, or official vendor security guides. Return a short title, the invariants that must hold, and a checklist.`,
      jsonFormat: { title: "", invariants: [""], checklist: [""] },
    });
  } catch (error) {
    if (error instanceof ResearchFailure && (error.status === 402 || error.status === 503)) throw error;
    failures.push("A standards lookup was unavailable.");
    return { json: {}, sources: [] as string[] };
  }
}
