import "server-only";

import { APIError, ContextDev } from "context.dev";
import { z } from "zod";
import type { CompanyHit, PersonHit, ResearchSource } from "@/lib/context-dev/source";
import { ResearchFailure } from "@/lib/research/failure";

// Company and people search stay on `ultra`. `fast` comes back empty too often for buyer briefs
// (Context.dev docs: ultra checks each result against every criterion). Web search, answers, and
// scrapes keep the quicker path with partial timeouts and docs caching.

const REQUEST = { maxRetries: 1 } as const;
const SEARCH_DEADLINE_MS = 12_000;
const ANSWER_DEADLINE_MS = 18_000;
// Official docs change slowly. Accept a week-old cached page so scrapes hit cache more often.
const DOCS_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

let client: ContextDev | null = null;

export function contextConfigured() {
  return Boolean(process.env.CONTEXT_DEV_API_KEY?.trim());
}

export function getResearchSource(): ResearchSource | null {
  const apiKey = process.env.CONTEXT_DEV_API_KEY?.trim();
  if (!apiKey) return null;
  // Ultra company search can take ~20s; complex ultra people search can take longer.
  if (!client) client = new ContextDev({ apiKey, timeout: 90_000, maxRetries: 1 });
  return createSource(client);
}

function createSource(context: ContextDev): ResearchSource {
  return {
    async searchCompanies(query) {
      const response = await call(() =>
        context.post<unknown>("/company/search", {
          ...REQUEST,
          body: { query: query.slice(0, 2000), mode: "ultra" },
        }),
      );
      const parsed = companyResponseSchema.safeParse(response);
      if (!parsed.success) throw new ResearchFailure("Company search returned an unexpected result.", 502);
      return (parsed.data.results ?? []).slice(0, 8).map(toCompany);
    },
    async searchPeople(input) {
      const response = await call(() =>
        context.people.search(
          {
            query: input.query.slice(0, 2000),
            mode: "ultra",
            filters: {
              ...(input.countries.length > 0 ? { countries: input.countries } : {}),
              ...(input.minYears > 0 ? { years_of_experience_min: input.minYears } : {}),
            },
          },
          REQUEST,
        ),
      );
      return response.results.slice(0, 8).flatMap((person) => {
        const name = person.name?.trim() ?? "";
        if (!name) return [];
        const location = [person.location.city, person.location.region, person.location.country_code]
          .filter(Boolean)
          .join(", ");
        return [
          {
            name,
            roleTitle: person.role.title?.trim() || "Role unknown",
            seniority: person.role.seniority?.trim() || "",
            companyName: person.role.company?.name?.trim() || "",
            companyDomain: person.role.company?.domain?.trim() || "",
            location,
            profileUrls: person.profiles.filter((url) => URL.canParse(url)).slice(0, 4),
            skills: person.skills.slice(0, 8),
            confidence: person.match?.confidence ?? null,
          } satisfies PersonHit,
        ];
      });
    },
    async searchNews(input) {
      const response = await call(() =>
        context.news.search({
          searchBy: input.domain
            ? { type: "entity", entity: { type: "domain", domain: input.domain } }
            : { type: "natural_language", query: (input.query ?? "").slice(0, 500) },
          limit: input.limit,
        }),
      );
      return response.data.slice(0, input.limit).map((article) => ({
        title: article.title,
        url: article.url,
        snippet: article.description?.slice(0, 500) || article.title,
        publishedAt: article.published_at,
      }));
    },
    async searchWeb(input) {
      const country = input.countryCode?.toLowerCase();
      const response = await call(() =>
        context.web.search({
          query: input.query.slice(0, 400),
          numResults: input.numResults,
          freshness: "last_year",
          descriptionMaxCharacters: 400,
          ...(input.includeDomains && input.includeDomains.length > 0
            ? { includeDomains: input.includeDomains.slice(0, 20) }
            : {}),
          ...(country ? { country: country as "fi" } : {}),
          // Prefer a partial page of results over waiting out a slow miss.
          timeoutOpts: { milliseconds: SEARCH_DEADLINE_MS, behavior: "return-partial" },
        }),
      );
      return response.results.slice(0, input.numResults).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.description.slice(0, 500),
        publishedAt: null,
      }));
    },
    async scrapeMarkdown(url) {
      const page = await call(() =>
        context.web.scrape({
          url,
          formats: { markdown: true },
          sharedParams: { mainContentOnly: true },
          maxAgeMs: DOCS_CACHE_MS,
          timeoutOpts: { milliseconds: SEARCH_DEADLINE_MS, behavior: "fail" },
        }),
      );
      if (page.markdown?.success !== true) return null;
      const text = page.markdown.data?.trim() ?? "";
      return text ? text.slice(0, 4000) : null;
    },
    async answers(input) {
      const response = await call(() =>
        context.web.answers({
          task: input.task.slice(0, 4000),
          json_format: input.jsonFormat,
          mode: "fast",
          timeoutOpts: { milliseconds: ANSWER_DEADLINE_MS, behavior: "return-partial" },
        }),
      );
      return {
        json: response.json_content ?? {},
        sources: response.sources.filter((url) => URL.canParse(url)).slice(0, 6),
      };
    },
  };
}

async function call<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ResearchFailure) throw error;
    if (error instanceof APIError) {
      if (error.status === 401 || error.status === 403) {
        throw new ResearchFailure("Context.dev rejected the API key.", 503);
      }
      if (error.status === 402) {
        throw new ResearchFailure("Context.dev is out of credits. Refill the account and run again.", 402);
      }
      throw new ResearchFailure("Context.dev could not finish that lookup.", 502);
    }
    throw new ResearchFailure("Context.dev could not finish that lookup.", 502);
  }
}

const companyResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            name: z.string(),
            domain: z.string(),
            description: z.string().nullable().optional(),
            headquarters: z
              .object({
                city: z.string().nullable().optional(),
                region: z.string().nullable().optional(),
                country_code: z.string().nullable().optional(),
              })
              .nullable()
              .optional(),
            employees: z
              .object({
                count: z.number().nullable().optional(),
                min: z.number().nullable().optional(),
                max: z.number().nullable().optional(),
              })
              .nullable()
              .optional(),
            funding: z
              .object({
                total_usd: z.number().nullable().optional(),
                stage: z.string().nullable().optional(),
                latest_round: z
                  .object({
                    type: z.string(),
                    date: z.string(),
                    amount_usd: z.number().nullable().optional(),
                  })
                  .nullable()
                  .optional(),
              })
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function toCompany(
  company: z.infer<typeof companyResponseSchema>["results"] extends Array<infer Item> | undefined ? Item : never,
): CompanyHit {
  const employees = company.employees;
  const headcount =
    employees?.count != null
      ? String(employees.count)
      : employees?.min != null && employees.max != null
        ? `${employees.min}–${employees.max}`
        : employees?.min != null
          ? `${employees.min}+`
          : "Unknown";
  const funding = company.funding;
  const fundingParts = [
    funding?.stage?.replaceAll("_", " "),
    funding?.latest_round ? `${funding.latest_round.type.replaceAll("_", " ")} ${funding.latest_round.date}` : "",
    funding?.total_usd != null ? `${formatUsd(funding.total_usd)} disclosed` : "",
  ].filter(Boolean);
  const headquarters = [company.headquarters?.city, company.headquarters?.region, company.headquarters?.country_code]
    .filter(Boolean)
    .join(", ");
  return {
    name: company.name,
    domain: company.domain,
    description: company.description?.trim() || "",
    headcount,
    fundingSummary: fundingParts.join(" · ") || "Funding not disclosed",
    headquarters,
  };
}

function formatUsd(amount: number) {
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}
