import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { canvasProposalSchema, findingSchema, type Analysis, type CanvasProposal, type Finding } from "@/lib/ai/schemas";
import { db, readyDb } from "@/lib/db";
import { analyses, leads, researchArtifacts } from "@/lib/db/schema";
import { citationSchema, type Citation } from "@/lib/research/citations";
import {
  LEAD_STATUSES,
  RESEARCH_KINDS,
  docPackSchema,
  leadSessionSchema,
  marketReportSchema,
  queryMetaSchema,
  standardsPackSchema,
  type DocPack,
  type LeadSession,
  type LeadStatus,
  type MarketReport,
  type QueryMeta,
  type ResearchKind,
  type StandardsPack,
} from "@/lib/research/schemas";

const storedAnalysisSchema = z.object({
  findings: z.array(findingSchema),
  canvasProposals: z.array(canvasProposalSchema).default([]),
});

export type StoredAnalysis = {
  id: string;
  summary: string;
  findings: Finding[];
  canvasProposals: CanvasProposal[];
  createdBy: string;
  createdAt: number;
};

export function saveAnalysis(input: {
  projectId: string;
  analysis: Analysis;
  createdBy: string;
}): StoredAnalysis {
  readyDb();
  const row = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    summary: input.analysis.summary,
    findingsJson: JSON.stringify({
      findings: input.analysis.findings,
      canvasProposals: input.analysis.canvasProposals,
    }),
    createdBy: input.createdBy,
    createdAt: Date.now(),
  };
  db.insert(analyses).values(row).run();
  return {
    id: row.id,
    summary: row.summary,
    findings: input.analysis.findings,
    canvasProposals: input.analysis.canvasProposals,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function latestAnalysis(projectId: string): StoredAnalysis | null {
  readyDb();
  const row = db
    .select()
    .from(analyses)
    .where(eq(analyses.projectId, projectId))
    .orderBy(desc(analyses.createdAt))
    .get();
  if (!row) return null;
  const parsed = storedAnalysisSchema.safeParse(readJson(row.findingsJson));
  if (!parsed.success) return null;
  return {
    id: row.id,
    summary: row.summary,
    findings: parsed.data.findings,
    canvasProposals: parsed.data.canvasProposals,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export type StoredArtifact = {
  id: string;
  kind: ResearchKind;
  title: string;
  inputHash: string;
  queryMeta: QueryMeta;
  content: MarketReport | DocPack | StandardsPack | LeadSession;
  citations: Citation[];
  createdBy: string;
  createdAt: number;
};

export function saveResearchArtifact(input: {
  projectId: string;
  kind: ResearchKind;
  title: string;
  inputHash: string;
  queryMeta: QueryMeta;
  content: MarketReport | DocPack | StandardsPack | LeadSession;
  citations: Citation[];
  createdBy: string;
}) {
  readyDb();
  const row = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    kind: input.kind,
    title: input.title,
    inputHash: input.inputHash,
    queryMetaJson: JSON.stringify(input.queryMeta),
    contentJson: JSON.stringify(input.content),
    citationsJson: JSON.stringify(input.citations),
    pinned: 0,
    createdBy: input.createdBy,
    createdAt: Date.now(),
  };
  db.insert(researchArtifacts).values(row).run();
  const stored = toArtifact(row);
  if (!stored) throw new Error("The research result could not be stored.");
  return stored;
}

export function latestResearchArtifact(projectId: string, kind: ResearchKind): StoredArtifact | null {
  readyDb();
  const row = db
    .select()
    .from(researchArtifacts)
    .where(and(eq(researchArtifacts.projectId, projectId), eq(researchArtifacts.kind, kind)))
    .orderBy(desc(researchArtifacts.createdAt))
    .get();
  return row ? toArtifact(row) : null;
}

export type LeadRecord = {
  id: string;
  personName: string;
  roleTitle: string;
  seniority: string;
  companyName: string;
  companyDomain: string;
  location: string;
  profileUrls: string[];
  skills: string[];
  matchConfidence: number | null;
  warmTrigger: string;
  outreachAngle: string;
  status: LeadStatus;
  createdAt: number;
};

export function replaceLeads(projectId: string, rows: LeadRecord[]) {
  readyDb();
  db.transaction((tx) => {
    tx.delete(leads).where(eq(leads.projectId, projectId)).run();
    if (rows.length === 0) return;
    tx.insert(leads)
      .values(
        rows.map((lead) => ({
          id: lead.id,
          projectId,
          personName: lead.personName,
          roleTitle: lead.roleTitle,
          seniority: lead.seniority,
          companyName: lead.companyName,
          companyDomain: lead.companyDomain,
          location: lead.location,
          profileUrlsJson: JSON.stringify(lead.profileUrls),
          skillsJson: JSON.stringify(lead.skills),
          matchConfidence: lead.matchConfidence,
          warmTrigger: lead.warmTrigger,
          outreachAngle: lead.outreachAngle,
          status: lead.status,
          createdAt: lead.createdAt,
        })),
      )
      .run();
  });
}

export function listLeads(projectId: string): LeadRecord[] {
  readyDb();
  return db
    .select()
    .from(leads)
    .where(eq(leads.projectId, projectId))
    .orderBy(desc(leads.createdAt))
    .all()
    .flatMap((row) => {
      const lead = toLead(row);
      return lead ? [lead] : [];
    });
}

export function updateLeadStatus(projectId: string, leadId: string, status: LeadStatus) {
  readyDb();
  const current = db
    .select()
    .from(leads)
    .where(and(eq(leads.projectId, projectId), eq(leads.id, leadId)))
    .get();
  if (!current) return null;
  db.update(leads).set({ status }).where(eq(leads.id, leadId)).run();
  return toLead({ ...current, status });
}

function toArtifact(row: typeof researchArtifacts.$inferSelect): StoredArtifact | null {
  if (!isResearchKind(row.kind)) return null;
  const citations = z.array(citationSchema).safeParse(readJson(row.citationsJson));
  const queryMeta = queryMetaSchema.safeParse(readJson(row.queryMetaJson));
  const content = parseContent(row.kind, readJson(row.contentJson));
  if (!citations.success || !queryMeta.success || !content) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    inputHash: row.inputHash,
    queryMeta: queryMeta.data,
    content,
    citations: citations.data,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function parseContent(kind: ResearchKind, value: unknown) {
  if (kind === "market") {
    const parsed = marketReportSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (kind === "docs") {
    const parsed = docPackSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (kind === "leads") {
    const parsed = leadSessionSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  const parsed = standardsPackSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toLead(row: typeof leads.$inferSelect): LeadRecord | null {
  if (!isLeadStatus(row.status)) return null;
  const profileUrls = z.array(z.string()).safeParse(readJson(row.profileUrlsJson));
  const skills = z.array(z.string()).safeParse(readJson(row.skillsJson));
  if (!profileUrls.success || !skills.success) return null;
  return {
    id: row.id,
    personName: row.personName,
    roleTitle: row.roleTitle,
    seniority: row.seniority,
    companyName: row.companyName,
    companyDomain: row.companyDomain,
    location: row.location,
    profileUrls: profileUrls.data,
    skills: skills.data,
    matchConfidence: row.matchConfidence,
    warmTrigger: row.warmTrigger,
    outreachAngle: row.outreachAngle,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function isResearchKind(value: string): value is ResearchKind {
  return (RESEARCH_KINDS as readonly string[]).includes(value);
}

function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

function readJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
