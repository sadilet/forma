import "server-only";

import { describeCitations } from "@/lib/research/citations";
import type { LeadSession, MarketReport } from "@/lib/research/schemas";
import { latestResearchArtifact, listLeads, type StoredArtifact } from "@/lib/records";

export async function researchPrompt(projectId: string, mode: "global" | "local" | "market" | "leads") {
  if (mode === "market") return marketPrompt(await latestResearchArtifact(projectId, "market"));
  if (mode === "leads") return await leadPrompt(projectId, await latestResearchArtifact(projectId, "leads"));
  return "";
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
