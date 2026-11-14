import { z } from "zod";
import { canvasProposalSchema, clip } from "@/lib/ai/schemas";

export const RESEARCH_KINDS = ["market", "docs", "standards", "leads"] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];

export const LEAD_STATUSES = ["new", "shortlisted", "contacted", "archived"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const marketReportSchema = z.object({
  demandVerdict: z.enum(["strong-pull", "crowded-wedge-needed", "unproven-niche", "weak"]),
  executiveSummary: z.string(),
  competitors: clip(
    z.object({
      name: z.string(),
      domain: z.string(),
      headcount: z.string(),
      fundingSummary: z.string(),
      positioning: z.string(),
      pricingModel: z.string(),
      strengths: clip(z.string(), 4),
      weaknesses: clip(z.string(), 4),
      citationIds: clip(z.string(), 8),
    }),
    8,
  ),
  marketSignals: clip(
    z.object({
      signal: z.string(),
      implication: z.string(),
      citationIds: clip(z.string(), 6),
    }),
    6,
  ),
  recommendedWedge: z.string(),
  wedgeCitationIds: clip(z.string(), 8),
  killRisks: clip(
    z.object({
      risk: z.string(),
      citationIds: clip(z.string(), 6),
    }),
    5,
  ),
  canvasProposals: clip(canvasProposalSchema, 4),
});

export type MarketReport = z.infer<typeof marketReportSchema>;

export const marketPlanSchema = z.object({
  companyQuery: z.string(),
  newsQuery: z.string(),
});

export const leadBriefSchema = z.object({
  targetCompanyQuery: z.string(),
  buyerPersonaQuery: z.string(),
  city: z.string(),
  country: z.string(),
  minExperienceYears: z.number().int().min(0).max(40),
});

export type LeadBrief = z.infer<typeof leadBriefSchema>;

export const leadSessionSchema = z.object({
  brief: leadBriefSchema,
  proposals: clip(canvasProposalSchema, 4),
});

export type LeadSession = z.infer<typeof leadSessionSchema>;

export const leadSynthesisSchema = z.object({
  leads: clip(
    z.object({
      index: z.number().int(),
      warmTrigger: z.string(),
      outreachAngle: z.string(),
      citationIds: clip(z.string(), 4),
    }),
    10,
  ),
  canvasProposals: clip(canvasProposalSchema, 4),
});

export const stackPlanSchema = z.object({
  packages: clip(
    z.object({
      packageName: z.string(),
      docsDomain: z.string(),
      query: z.string(),
    }),
    5,
  ),
});

export const docPackSchema = z.object({
  summary: z.string(),
  packages: clip(
    z.object({
      packageName: z.string(),
      versionOrEra: z.string(),
      officialDocsUrl: z.string(),
      verifiedImports: clip(z.string(), 8),
      canonicalUsageSnippets: clip(z.string(), 4),
      breakingChangesAndDeprecations: clip(z.string(), 6),
      citationIds: clip(z.string(), 6),
    }),
    6,
  ),
});

export type DocPack = z.infer<typeof docPackSchema>;

export const surfacePlanSchema = z.object({
  surfaces: clip(
    z.object({
      category: z.string(),
      question: z.string(),
      blockIds: clip(z.string(), 8),
    }),
    4,
  ),
});

export const standardsPackSchema = z.object({
  summary: z.string(),
  standards: clip(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      appliesToBlockIds: clip(z.string(), 8),
      mustHoldInvariants: clip(z.string(), 6),
      failureModeHandling: clip(z.string(), 6),
      implementationChecklist: clip(z.string(), 8),
      citationIds: clip(z.string(), 6),
    }),
    6,
  ),
});

export type StandardsPack = z.infer<typeof standardsPackSchema>;

export const queryMetaSchema = z.object({
  queries: z.array(z.string()),
  failures: z.array(z.string()),
  geography: z.string(),
  assumedGeography: z.boolean(),
});

export type QueryMeta = z.infer<typeof queryMetaSchema>;
