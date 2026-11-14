import "server-only";

import { describeSpecification } from "@/lib/ai/prompt";
import type { ChatMode } from "@/lib/architect/tabs";
import { listSpecifications } from "@/lib/projects";
import { describeCitations, type Citation } from "@/lib/research/citations";
import type { DocPack, LeadSession, MarketReport, StandardsPack } from "@/lib/research/schemas";
import { latestAnalysis, latestResearchArtifact, listLeads, type StoredAnalysis, type StoredArtifact } from "@/lib/records";

export async function researchPrompt(projectId: string, mode: ChatMode) {
  if (mode === "market") return marketPrompt(await latestResearchArtifact(projectId, "market"));
  if (mode === "leads") return leadPrompt(projectId, await latestResearchArtifact(projectId, "leads"));
  if (mode === "review") return reviewPrompt(await latestAnalysis(projectId));
  if (mode === "engineering") {
    return engineeringPrompt(
      projectId,
      await latestResearchArtifact(projectId, "docs"),
      await latestResearchArtifact(projectId, "standards"),
    );
  }
  return "";
}

// Citations the model may use for a mode. Engineering answers can lean on both the docs and the standards pack.
export async function citationsForMode(projectId: string, mode: ChatMode): Promise<Citation[]> {
  if (mode === "market" || mode === "leads") return (await latestResearchArtifact(projectId, mode))?.citations ?? [];
  if (mode === "engineering") {
    const merged = new Map<string, Citation>();
    for (const kind of ["docs", "standards"] as const) {
      for (const citation of (await latestResearchArtifact(projectId, kind))?.citations ?? []) merged.set(citation.id, citation);
    }
    return [...merged.values()];
  }
  return [];
}

function reviewPrompt(analysis: StoredAnalysis | null) {
  if (!analysis) return "No canvas review is saved yet. Answer from the canvas, and say a review has not been run.";
  return [
    "Latest saved canvas review. Build on these findings. Do not repeat them word for word.",
    `Summary: ${analysis.summary}`,
    ...analysis.findings.map(
      (finding) =>
        `- [${finding.severity}] ${finding.title}${finding.relatedBlockTitle ? ` (${finding.relatedBlockTitle})` : ""}: ${finding.description} Open question: ${finding.question}`,
    ),
  ].join("\n");
}

async function engineeringPrompt(projectId: string, docs: StoredArtifact | null, standards: StoredArtifact | null) {
  const docPack = docs && isDocs(docs) ? docs.content : null;
  const standardsPack = standards && isStandards(standards) ? standards.content : null;
  const specs = await listSpecifications(projectId);
  const lines: string[] = [
    "Engineering grounding. Answer with the official documentation and standards below. Cite ids from the sources list. Do not invent APIs, imports, or standards.",
  ];

  if (docPack) {
    lines.push("", "Official SDK documentation pack", docPack.summary);
    for (const entry of docPack.packages) {
      lines.push(
        ...[
          `- ${entry.packageName} (${entry.versionOrEra}) ${entry.officialDocsUrl} [${entry.citationIds.join(", ")}]`,
          entry.verifiedImports.length ? `  Verified imports: ${entry.verifiedImports.join("; ")}` : "",
          entry.breakingChangesAndDeprecations.length
            ? `  Deprecations and breaking changes: ${entry.breakingChangesAndDeprecations.join("; ")}`
            : "",
        ].filter(Boolean),
      );
    }
  } else {
    lines.push("", "No documentation pack is saved yet. Say so, and do not invent SDK details.");
  }

  if (standardsPack) {
    lines.push("", "Engineering standards", standardsPack.summary);
    for (const standard of standardsPack.standards) {
      lines.push(
        ...[
          `- ${standard.title} (${standard.category}) applies to: ${standard.appliesToBlockIds.join(", ") || "whole system"} [${standard.citationIds.join(", ")}]`,
          standard.mustHoldInvariants.length ? `  Invariants: ${standard.mustHoldInvariants.join("; ")}` : "",
          standard.failureModeHandling.length ? `  Failure handling: ${standard.failureModeHandling.join("; ")}` : "",
          standard.implementationChecklist.length ? `  Checklist: ${standard.implementationChecklist.join("; ")}` : "",
        ].filter(Boolean),
      );
    }
  } else {
    lines.push("", "No standards pack is saved yet. Say so, and do not invent compliance requirements.");
  }

  if (specs.length > 0) {
    lines.push("", "Saved component specifications");
    for (const entry of specs) lines.push(`Component [${entry.blockId}]`, describeSpecification(entry.specification));
  }

  const citations = [...(docs?.citations ?? []), ...(standards?.citations ?? [])];
  if (citations.length > 0) lines.push("", "Sources", describeCitations(dedupe(citations)));
  return lines.join("\n");
}

function dedupe(citations: Citation[]) {
  return [...new Map(citations.map((citation) => [citation.id, citation])).values()];
}

function isDocs(artifact: StoredArtifact): artifact is StoredArtifact & { content: DocPack } {
  return artifact.kind === "docs" && "packages" in artifact.content && !("standards" in artifact.content);
}

function isStandards(artifact: StoredArtifact): artifact is StoredArtifact & { content: StandardsPack } {
  return artifact.kind === "standards" && "standards" in artifact.content;
}

function marketPrompt(artifact: StoredArtifact | null) {
  const report = artifact && isMarket(artifact) ? artifact.content : null;
  if (!artifact || !report) return "No market report is saved yet. Say so, and do not invent competitors or prices.";
  return [
    "Latest cited market report. Use these sources and no others.",
    `Verdict: ${report.demandVerdict}`,
    report.executiveSummary,
    `Wedge: ${report.recommendedWedge}`,
    ...report.killRisks.map((risk) => `Kill risk: ${risk.risk}`),
    describeCitations(artifact.citations),
  ].join("\n");
}

async function leadPrompt(projectId: string, artifact: StoredArtifact | null) {
  const leads = await listLeads(projectId);
  if (leads.length === 0) return "No leads are saved yet. Say so, and do not invent people.";
  const session = artifact && isLeadSession(artifact) ? artifact.content : null;
  return [
    "Latest cited leads. Recommend who the product is for, and what decision or note should change on the canvas.",
    "Do not paste every person onto the canvas.",
    session ? `Buyer brief: ${session.brief.buyerPersonaQuery}` : "",
    ...leads.map(
      (lead) =>
        `- ${lead.personName}, ${lead.roleTitle} at ${lead.companyName || "unknown"} (${lead.status}). Trigger: ${lead.warmTrigger || "none"}. Angle: ${lead.outreachAngle || "none"}.`,
    ),
    artifact ? describeCitations(artifact.citations) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isMarket(artifact: StoredArtifact): artifact is StoredArtifact & { content: MarketReport } {
  return artifact.kind === "market" && "demandVerdict" in artifact.content;
}

function isLeadSession(artifact: StoredArtifact): artifact is StoredArtifact & { content: LeadSession } {
  return artifact.kind === "leads" && "brief" in artifact.content;
}
