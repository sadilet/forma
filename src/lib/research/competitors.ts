import type { CompanyHit } from "../context-dev/source.ts";
import { domainOf, keepKnownIds, websiteUrl, type Citation } from "./citations.ts";
import type { MarketReport } from "./schemas.ts";

type Competitor = MarketReport["competitors"][number];
type Source = { company: CompanyHit; domain: string; citationId: string };

function nameKey(name: string) {
  return name.trim().toLowerCase();
}

function domainKey(domain: string) {
  const url = websiteUrl(domain);
  return url ? domainOf(url) : "";
}

export function bindCompetitors(drafted: Competitor[], companies: CompanyHit[], citations: Citation[]): Competitor[] {
  const known = new Set(citations.map((citation) => citation.id));
  const byDomain = new Map<string, Source>();
  const byName = new Map<string, Source>();
  for (const company of companies) {
    const url = websiteUrl(company.domain);
    const citation = url ? citations.find((item) => item.url === url) : undefined;
    if (!url || !citation) continue;
    const source = { company, domain: domainOf(url), citationId: citation.id };
    byDomain.set(source.domain, source);
    byName.set(nameKey(company.name), source);
  }

  const bound = new Set<string>();
  return drafted.flatMap((competitor) => {
    const source = byDomain.get(domainKey(competitor.domain)) ?? byName.get(nameKey(competitor.name));
    if (!source || bound.has(source.domain)) return [];
    bound.add(source.domain);
    return [
      {
        ...competitor,
        name: source.company.name,
        domain: source.domain,
        headcount: source.company.headcount,
        fundingSummary: source.company.fundingSummary,
        citationIds: keepKnownIds([source.citationId, ...competitor.citationIds], known),
      },
    ];
  });
}
