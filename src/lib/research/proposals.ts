import type { CanvasProposal, CanvasSnapshot } from "../ai/schemas";
import { keepKnownIds } from "./citations.ts";

const CONCLUSION_KINDS = new Set(["decision", "note"]);

export function acceptProposals(input: {
  proposals: CanvasProposal[];
  canvas: CanvasSnapshot;
  citationIds: Set<string>;
  scope: "conclusions" | "block";
  focusBlockId?: string;
}): CanvasProposal[] {
  const blocks = new Map(input.canvas.blocks.map((block) => [block.id, block]));
  const accepted: CanvasProposal[] = [];
  for (const proposal of input.proposals) {
    const next = cleanProposal(proposal, input.citationIds);
    if (!next) continue;
    if (input.scope === "block") {
      const block = input.focusBlockId ? blocks.get(input.focusBlockId) : undefined;
      if (!block || next.action !== "update") continue;
      accepted.push({ ...next, action: "update", blockId: block.id, kind: block.kind, title: block.title });
    } else if (next.action === "update") {
      const block = next.blockId ? blocks.get(next.blockId) : undefined;
      if (!block || !CONCLUSION_KINDS.has(block.kind)) continue;
      accepted.push({ ...next, kind: block.kind, title: block.title });
    } else if (CONCLUSION_KINDS.has(next.kind)) {
      accepted.push({ ...next, action: "create", blockId: null });
    }
    if (accepted.length === 4) break;
  }
  return accepted;
}

export function landWedge(input: {
  proposals: CanvasProposal[];
  canvas: CanvasSnapshot;
  citationIds: Set<string>;
  wedge: string;
  wedgeCitationIds: string[];
}) {
  const accepted = acceptProposals({
    proposals: input.proposals,
    canvas: input.canvas,
    citationIds: input.citationIds,
    scope: "conclusions",
  });
  const wedge = input.wedge.trim();
  if (accepted.length > 0 || !wedge) return accepted;
  const conclusions = input.canvas.blocks.filter((block) => block.kind === "decision" || block.kind === "note");
  const words = wedge.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4);
  const target = conclusions
    .map((block) => ({
      block,
      score: words.filter((word) => `${block.title} ${block.description}`.toLowerCase().includes(word)).length,
    }))
    .sort((left, right) => right.score - left.score)[0]?.block;
  return acceptProposals({
    proposals: [
      {
        action: target ? "update" : "create",
        blockId: target?.id ?? null,
        kind: target?.kind ?? "decision",
        title: target?.title || "Market wedge",
        description: wedge,
        reason: "This is the wedge the research recommends writing onto the canvas.",
        citationIds: input.wedgeCitationIds,
      },
    ],
    canvas: input.canvas,
    citationIds: input.citationIds,
    scope: "conclusions",
  });
}

function cleanProposal(proposal: CanvasProposal, citationIds: Set<string>): CanvasProposal | null {
  const description = proposal.description.trim().slice(0, 800);
  const title = proposal.title.trim().slice(0, 80);
  if (!description || (proposal.action === "create" && !title)) return null;
  return {
    action: proposal.action,
    blockId: proposal.blockId?.trim() || null,
    kind: proposal.kind,
    title,
    description,
    reason: proposal.reason.trim().slice(0, 400),
    citationIds: keepKnownIds(proposal.citationIds, citationIds),
  };
}
