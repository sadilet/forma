import "server-only";

import type { Architect } from "@/lib/ai/provider";
import { describeCanvas } from "@/lib/ai/prompt";
import type { CanvasProposal, CanvasSnapshot } from "@/lib/ai/schemas";
import type { PersonHit, ResearchSource } from "@/lib/context-dev/source";
import { catalogFromHits, describeCitations, keepKnownIds, websiteUrl, type Citation, type CitationHit } from "@/lib/research/citations";
import { ResearchFailure } from "@/lib/research/failure";
import { localeLabel, type ResearchLocale } from "@/lib/research/locale";
import { acceptProposals } from "@/lib/research/proposals";
import { leadBriefSchema, leadSynthesisSchema, type LeadBrief, type QueryMeta } from "@/lib/research/schemas";
import { settleList } from "@/lib/research/settle";
import type { LeadRecord } from "@/lib/records";

export async function draftLeadBrief(input: {
  architect: Architect;
  goal: string;
  canvas: CanvasSnapshot;
  locale: ResearchLocale;
}): Promise<LeadBrief> {
  const fallback: LeadBrief = {
    targetCompanyQuery: `${input.goal.slice(0, 180)} in ${localeLabel(input.locale) || input.locale.country}`.slice(0, 300),
    buyerPersonaQuery: "owner or operator who feels the problem in the goal",
    city: input.locale.city,
    country: input.locale.country,
    minExperienceYears: 5,
  };
  try {
    const drafted = await input.architect.completeJson({
      schema: leadBriefSchema,
      schemaName: "lead_brief",
      temperature: 0.2,
      system:
        "Draft an editable ideal-customer brief from a product canvas. Do not invent companies or people. Leave the city empty when the canvas does not name one.",
      prompt: `Goal:\n${input.goal}\n\nSuggested place: ${localeLabel(input.locale) || "unclear"}\n\n${describeCanvas(input.canvas)}`,
    });
    return {
      targetCompanyQuery: drafted.targetCompanyQuery.trim().slice(0, 400) || fallback.targetCompanyQuery,
      buyerPersonaQuery: drafted.buyerPersonaQuery.trim().slice(0, 400) || fallback.buyerPersonaQuery,
      city: drafted.city.trim() || fallback.city,
      country: drafted.country.trim() || fallback.country,
      minExperienceYears: drafted.minExperienceYears,
    };
  } catch {
    return fallback;
  }
}

export async function runLeadResearch(input: {
  source: ResearchSource;
  architect: Architect;
  projectName: string;
  goal: string;
  canvas: CanvasSnapshot;
  brief: LeadBrief;
  locale: ResearchLocale;
}): Promise<{ leads: LeadRecord[]; proposals: CanvasProposal[]; citations: Citation[]; queryMeta: QueryMeta }> {
  const failures: string[] = [];
  const place = localeLabel(input.locale);
  const companyQuery = `${input.brief.targetCompanyQuery} in ${place}`.slice(0, 700);
  const peopleQuery = `${input.brief.buyerPersonaQuery} at ${input.brief.targetCompanyQuery} in ${place}`.slice(0, 700);
  const [companies, people] = await Promise.all([
    settleList(input.source.searchCompanies(companyQuery), failures, "Company search was unavailable."),
    input.source.searchPeople({
      query: peopleQuery,
      countries: input.locale.countryCode ? [input.locale.countryCode] : [],
      minYears: input.brief.minExperienceYears,
    }),
  ]);
  if (people.length === 0) {
    throw new ResearchFailure("No people matched this brief. Change the buyer, the place, or the years of experience.", 422);
  }

  const hits: CitationHit[] = [];
  for (const company of companies) {
    const url = websiteUrl(company.domain);
    if (!url) continue;
    hits.push({
      title: company.name,
      url,
      sourceKind: "company",
      snippet: [company.description, company.headquarters, company.fundingSummary].filter(Boolean).join(" · "),
    });
  }
  for (const person of people) {
    const url = person.profileUrls[0];
    if (!url) continue;
    hits.push({
      title: person.name,
      url,
      sourceKind: "profile",
      snippet: [person.roleTitle, person.companyName, person.location].filter(Boolean).join(" · "),
    });
  }

  const domains = [...new Set(people.map((person) => person.companyDomain).filter(Boolean))].slice(0, 5);
  const articles = (
    await Promise.all(
      domains.map((domain) =>
        settleList(input.source.searchNews({ domain, limit: 2 }), failures, `News for ${domain} was unavailable.`),
      ),
    )
  ).flat();
  for (const article of articles) hits.push({ ...article, sourceKind: "news" });

  const citations = catalogFromHits(hits);
  const known = new Set(citations.map((citation) => citation.id));
  const synthesized = await input.architect.completeJson({
    schema: leadSynthesisSchema,
    schemaName: "lead_synthesis",
    temperature: 0.3,
    system: [
      "You write a warm trigger and a two-sentence outreach angle for each person.",
      "A warm trigger must cite a news or company source id. If none applies, return an empty trigger and no citation ids.",
      "The outreach angle uses the canvas value proposition and the person's role. Do not invent funding, hiring, or news.",
      "Propose one or two canvas updates that lock who the product is for. Do not copy every person onto the canvas.",
    ].join(" "),
    prompt: [
      `Project: ${input.projectName}`,
      `Goal: ${input.goal}`,
      `Place: ${place}`,
      "",
      describeCanvas(input.canvas),
      "",
      "People",
      ...people.map((person, index) => describePerson(index, person)),
      "",
      "Sources",
      describeCitations(citations),
    ]
      .join("\n")
      .slice(0, 16_000),
  });

  const now = Date.now();
  const leads = people.map((person, index) => {
    const match = synthesized.leads.find((lead) => lead.index === index);
    const citationIds = keepKnownIds(match?.citationIds ?? [], known);
    return {
      id: crypto.randomUUID(),
      personName: person.name,
      roleTitle: person.roleTitle,
      seniority: person.seniority,
      companyName: person.companyName,
      companyDomain: person.companyDomain,
      location: person.location,
      profileUrls: person.profileUrls,
      skills: person.skills,
      matchConfidence: person.confidence,
      warmTrigger: citationIds.length > 0 ? match?.warmTrigger.trim() || "" : "",
      outreachAngle: match?.outreachAngle.trim() || "",
      status: "new" as const,
      createdAt: now + index,
    };
  });

  return {
    leads,
    proposals: acceptProposals({
      proposals: synthesized.canvasProposals,
      canvas: input.canvas,
      citationIds: known,
      scope: "conclusions",
    }),
    citations,
    queryMeta: {
      queries: [companyQuery, peopleQuery],
      failures,
      geography: place,
      assumedGeography: input.locale.assumed,
    },
  };
}

function describePerson(index: number, person: PersonHit) {
  return `- [${index}] ${person.name}, ${person.roleTitle} at ${person.companyName || "unknown company"} (${person.companyDomain || "no domain"}), ${person.location || "location unknown"}. Profiles: ${person.profileUrls.join(", ") || "none"}.`;
}
