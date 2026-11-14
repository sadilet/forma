import { z } from "zod";

export const citationSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  domain: z.string(),
  sourceKind: z.enum(["company", "news", "docs", "standard", "pricing", "profile"]),
  snippet: z.string(),
  publishedOrUpdatedAt: z.string().nullable(),
  retrievedAt: z.number(),
});

export type Citation = z.infer<typeof citationSchema>;
export type CitationKind = Citation["sourceKind"];

export type CitationHit = {
  title: string;
  url: string;
  snippet: string;
  sourceKind: CitationKind;
  publishedAt?: string | null;
};

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function websiteUrl(domain: string) {
  const trimmed = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!trimmed || trimmed.includes(" ") || !trimmed.includes(".")) return null;
  const url = `https://${trimmed}`;
  return URL.canParse(url) ? url : null;
}

function citationId(url: string, taken: Set<string>) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const base = `cit_${(hash >>> 0).toString(36)}`;
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}_${suffix}`;
  return id;
}

export function catalogFromHits(hits: CitationHit[], retrievedAt = Date.now()): Citation[] {
  const seen = new Set<string>();
  const ids = new Set<string>();
  const citations: Citation[] = [];
  for (const hit of hits) {
    const url = hit.url.trim();
    if (!url || seen.has(url) || !URL.canParse(url)) continue;
    seen.add(url);
    const id = citationId(url, ids);
    ids.add(id);
    citations.push({
      id,
      title: hit.title.trim() || domainOf(url),
      url,
      domain: domainOf(url),
      sourceKind: hit.sourceKind,
      snippet: hit.snippet.trim().slice(0, 500),
      publishedOrUpdatedAt: hit.publishedAt ?? null,
      retrievedAt,
    });
  }
  return citations;
}

export function keepKnownIds(ids: string[], known: Set<string>) {
  const kept: string[] = [];
  for (const id of ids) {
    if (!known.has(id) || kept.includes(id)) continue;
    kept.push(id);
  }
  return kept;
}

export function describeCitations(citations: Citation[]) {
  if (citations.length === 0) return "No retrieved sources.";
  return citations
    .map((citation) => `- [${citation.id}] ${citation.title} (${citation.domain}) ${citation.url}\n  ${citation.snippet}`)
    .join("\n");
}
