import "server-only";

import { getResearchSource } from "@/lib/context-dev/client";
import { ResearchFailure } from "@/lib/research/failure";
import { type LookupKind } from "@/lib/voice/protocol";


export type LiveLookupResult = {
  kind: LookupKind;
  question: string;
  summary: string;
  findings: Array<{ title: string; detail: string; url?: string }>;
  sources: string[];
  notice: string | null;
};

export async function liveLookup(question: string, kind: LookupKind = "answer"): Promise<LiveLookupResult> {
  const trimmed = question.trim().slice(0, 400);
  if (!trimmed) {
    return empty(kind, question, "Pass a short question to look up.");
  }
  const source = getResearchSource();
  if (!source) {
    return empty(
      kind,
      trimmed,
      "Live web lookup is off. Add CONTEXT_DEV_API_KEY to .env.local, or rely on saved Research and Engineering packs.",
    );
  }

  try {
    if (kind === "answer") return await answerLookup(source, trimmed);
    if (kind === "web") return await webLookup(source, trimmed);
    if (kind === "companies") return await companyLookup(source, trimmed);
    if (kind === "people") return await peopleLookup(source, trimmed);
    return await newsLookup(source, trimmed);
  } catch (error) {
    if (error instanceof ResearchFailure) return empty(kind, trimmed, error.message);
    return empty(kind, trimmed, "That live lookup could not finish.");
  }
}

async function answerLookup(
  source: NonNullable<ReturnType<typeof getResearchSource>>,
  question: string,
): Promise<LiveLookupResult> {
  const result = await source.answers({
    task: [
      "Answer this product research question briefly for a spoken conversation.",
      "Use only facts you can support. Prefer official docs, company sites, and reputable news.",
      "Keep the summary under 60 words.",
      "",
      question,
    ].join("\n"),
    jsonFormat: {
      summary: "",
      facts: [{ title: "", detail: "" }],
    },
  });
  const json = result.json as { summary?: unknown; facts?: unknown };
  const summary = typeof json.summary === "string" ? json.summary.trim() : "";
  const facts = Array.isArray(json.facts)
    ? json.facts.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { title?: unknown; detail?: unknown };
        const title = typeof row.title === "string" ? row.title.trim() : "";
        const detail = typeof row.detail === "string" ? row.detail.trim() : "";
        if (!title && !detail) return [];
        return [{ title: title || "Finding", detail: detail || title }];
      })
    : [];
  return {
    kind: "answer",
    question,
    summary: summary || (facts[0]?.detail ?? "No clear answer came back from the live web."),
    findings: facts.slice(0, 5),
    sources: result.sources.slice(0, 5),
    notice: null,
  };
}

async function webLookup(
  source: NonNullable<ReturnType<typeof getResearchSource>>,
  question: string,
): Promise<LiveLookupResult> {
  const hits = await source.searchWeb({ query: question, numResults: 5 });
  if (hits.length === 0) return empty("web", question, "No web results matched that question.");
  return {
    kind: "web",
    question,
    summary: `Found ${hits.length} pages that look relevant.`,
    findings: hits.map((hit) => ({ title: hit.title, detail: hit.snippet, url: hit.url })),
    sources: hits.map((hit) => hit.url),
    notice: null,
  };
}

async function companyLookup(
  source: NonNullable<ReturnType<typeof getResearchSource>>,
  question: string,
): Promise<LiveLookupResult> {
  const companies = await source.searchCompanies(question);
  if (companies.length === 0) return empty("companies", question, "No companies matched that question.");
  return {
    kind: "companies",
    question,
    summary: `Found ${companies.length} companies.`,
    findings: companies.slice(0, 5).map((company) => ({
      title: company.name,
      detail: [company.domain, company.description, company.headquarters, company.fundingSummary]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 400),
      url: company.domain.includes(".") ? `https://${company.domain.replace(/^https?:\/\//, "")}` : undefined,
    })),
    sources: companies
      .slice(0, 5)
      .map((company) => (company.domain.includes(".") ? `https://${company.domain.replace(/^https?:\/\//, "")}` : ""))
      .filter(Boolean),
    notice: null,
  };
}

async function peopleLookup(
  source: NonNullable<ReturnType<typeof getResearchSource>>,
  question: string,
): Promise<LiveLookupResult> {
  const people = await source.searchPeople({ query: question, countries: [], minYears: 0 });
  if (people.length === 0) return empty("people", question, "No people matched that question.");
  return {
    kind: "people",
    question,
    summary: `Found ${people.length} people.`,
    findings: people.slice(0, 5).map((person) => ({
      title: person.name,
      detail: [person.roleTitle, person.companyName, person.location].filter(Boolean).join(" · "),
      url: person.profileUrls[0],
    })),
    sources: people.flatMap((person) => person.profileUrls.slice(0, 1)).slice(0, 5),
    notice: null,
  };
}

async function newsLookup(
  source: NonNullable<ReturnType<typeof getResearchSource>>,
  question: string,
): Promise<LiveLookupResult> {
  const articles = await source.searchNews({ query: question, limit: 5 });
  if (articles.length === 0) return empty("news", question, "No news matched that question.");
  return {
    kind: "news",
    question,
    summary: `Found ${articles.length} recent articles.`,
    findings: articles.map((article) => ({
      title: article.title,
      detail: article.snippet,
      url: article.url,
    })),
    sources: articles.map((article) => article.url),
    notice: null,
  };
}

function empty(kind: LookupKind, question: string, notice: string): LiveLookupResult {
  return { kind, question, summary: "", findings: [], sources: [], notice };
}
