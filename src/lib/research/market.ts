import "server-only";

import type { Architect } from "@/lib/ai/provider";
import { describeCanvas } from "@/lib/ai/prompt";
import type { CanvasSnapshot } from "@/lib/ai/schemas";
import type { CompanyHit, ResearchSource } from "@/lib/context-dev/source";
import { bindCompetitors } from "@/lib/research/competitors";
import {
  catalogFromHits,
  describeCitations,
  keepKnownIds,
  websiteUrl,
  type Citation,
  type CitationHit,
} from "@/lib/research/citations";
import { ResearchFailure } from "@/lib/research/failure";
import { localeLabel, type ResearchLocale } from "@/lib/research/locale";
import { landWedge } from "@/lib/research/proposals";
import { marketPlanSchema, marketReportSchema, type MarketReport, type QueryMeta } from "@/lib/research/schemas";
import { settleList, settleText } from "@/lib/research/settle";

export async function runMarketResearch(input: {
  source: ResearchSource;
  architect: Architect;
  projectName: string;
  goal: string;
  canvas: CanvasSnapshot;
  locale: ResearchLocale;
}): Promise<{ report: MarketReport; citations: Citation[]; queryMeta: QueryMeta }> {
  const failures: string[] = [];
  const queries: string[] = [];
  const place = localeLabel(input.locale) || input.locale.country || "the canvas does not name a place";
  const plan = await planQueries(input, place, failures);
  queries.push(plan.companyQuery, plan.newsQuery);

  const companies = await input.source.searchCompanies(plan.companyQuery);
  if (companies.length === 0) {
    throw new ResearchFailure("No companies matched this canvas. Change the place or the goal and run again.", 422);
  }

  const hits: CitationHit[] = [];
  for (const company of companies) {
    const url = websiteUrl(company.domain);
    if (!url) continue;
    hits.push({
      title: company.name,
      url,
      sourceKind: "company",
      snippet: [company.description, company.headquarters, `Headcount ${company.headcount}`, company.fundingSummary]
        .filter(Boolean)
        .join(" · "),
    });
  }

  const marketNews = await settleList(
    input.source.searchNews({ query: plan.newsQuery, limit: 5 }),
    failures,
    "Market news was unavailable.",
  );
  for (const article of marketNews) hits.push({ ...article, sourceKind: "news" });

  const domainNews = await Promise.all(
    companies.slice(0, 3).map((company) =>
      settleList(
        input.source.searchNews({ domain: company.domain, limit: 2 }),
        failures,
        `News for ${company.domain} was unavailable.`,
      ),
    ),
  );
  for (const article of domainNews.flat()) hits.push({ ...article, sourceKind: "news" });

  const pricing = await Promise.all(
    companies.slice(0, 4).map((company) =>
      settleList(
        input.source.searchWeb({
          query: `${company.name} pricing`,
          numResults: 2,
          countryCode: input.locale.countryCode || undefined,
        }),
        failures,
        `Pricing search for ${company.name} was unavailable.`,
      ),
    ),
  );
  const pricingHits = pricing.flat();
  for (const hit of pricingHits) hits.push({ ...hit, sourceKind: "pricing" });

  const pages = (
    await Promise.all(
      pricingHits.slice(0, 4).map(async (hit) => {
        const markdown = await settleText(
          input.source.scrapeMarkdown(hit.url),
          failures,
          `Could not read ${hit.url}.`,
        );
        return markdown ? { url: hit.url, markdown } : null;
      }),
    )
  ).filter((page) => page !== null);

  const citations = catalogFromHits(hits);
  if (citations.length === 0) throw new ResearchFailure("The search returned no citable sources.", 502);
  const drafted = await input.architect.completeJson({
    schema: marketReportSchema,
    schemaName: "market_report",
    temperature: 0.3,
    system: [
      "You are Forma's market researcher.",
      "Use only the retrieved sources. Cite their ids on every competitor, signal, kill risk, and wedge claim.",
      "Every competitor must be one of the listed companies. Copy its domain exactly as listed.",
      "If a fact is not in the sources, leave it out.",
      "Return at least one canvasProposal. Update an existing decision or note by its id from the canvas, or create a decision when none of them can hold the conclusion. The description replaces that block after the team confirms. Build will read the canvas, so the description has to be specific.",
      "Do not invent citation ids.",
    ].join(" "),
    prompt: [
      `Project: ${input.projectName}`,
      `Goal: ${input.goal}`,
      `Place: ${place}`,
      "",
      describeCanvas(input.canvas),
      "",
      "Companies",
      ...companies.map(
        (company) =>
          `- ${company.name} (${company.domain}) HQ ${company.headquarters || "unknown"}; headcount ${company.headcount}; ${company.fundingSummary}. ${company.description}`,
      ),
      "",
      "Sources",
      describeCitations(citations),
      "",
      "Pricing pages",
      ...pages.map((page) => `URL ${page.url}\n${page.markdown}`),
    ]
      .join("\n")
      .slice(0, 16_000),
  });

  const report = bindReport(drafted, companies, citations, input.canvas);
  if (report.competitors.length === 0) {
    throw new ResearchFailure(
      "The sources were not strong enough to name a cited competitor. Narrow the canvas and run again.",
      502,
    );
  }
  return {
    report,
    citations,
    queryMeta: {
      queries,
      failures,
      geography: place,
      assumedGeography: input.locale.assumed,
    },
  };
}

async function planQueries(
  input: { architect: Architect; goal: string; canvas: CanvasSnapshot },
  place: string,
  failures: string[],
) {
  const fallback = {
    companyQuery: `${input.goal.slice(0, 220)} competitors in ${place}`.slice(0, 700),
    newsQuery: `funding product launches ${input.goal.slice(0, 160)} ${place}`.slice(0, 400),
  };
  try {
    const drafted = await input.architect.completeJson({
      schema: marketPlanSchema,
      schemaName: "market_query_plan",
      temperature: 0.2,
      system: "Plan live company and news searches. Return queries only. Do not invent market facts.",
      prompt: `Goal:\n${input.goal}\n\nPlace: ${place}\n\n${describeCanvas(input.canvas)}\n\nInclude the place in both queries.`,
    });
    return {
      companyQuery: drafted.companyQuery.trim().slice(0, 700) || fallback.companyQuery,
      newsQuery: drafted.newsQuery.trim().slice(0, 400) || fallback.newsQuery,
    };
  } catch {
    failures.push("The query plan used the canvas text directly.");
    return fallback;
  }
}

function bindReport(
  report: MarketReport,
  companies: CompanyHit[],
  citations: Citation[],
  canvas: CanvasSnapshot,
): MarketReport {
  const known = new Set(citations.map((citation) => citation.id));
  const competitors = bindCompetitors(report.competitors, companies, citations);
  const marketSignals = report.marketSignals.flatMap((signal) => {
    const citationIds = keepKnownIds(signal.citationIds, known);
    if (citationIds.length === 0) return [];
    return [{ ...signal, citationIds }];
  });
  const killRisks = report.killRisks.flatMap((risk) => {
    const citationIds = keepKnownIds(risk.citationIds, known);
    if (citationIds.length === 0) return [];
    return [{ ...risk, citationIds }];
  });
  return {
    ...report,
    competitors,
    marketSignals,
    killRisks,
    wedgeCitationIds: keepKnownIds(report.wedgeCitationIds, known),
    canvasProposals: landWedge({
      proposals: report.canvasProposals,
      canvas,
      citationIds: known,
      wedge: report.recommendedWedge,
      wedgeCitationIds: report.wedgeCitationIds,
    }),
  };
}
