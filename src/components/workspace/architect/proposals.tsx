"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Editor } from "tldraw";
import { Button } from "@/components/ui";
import type { CanvasProposal } from "@/lib/ai/schemas";
import type { Citation } from "@/lib/research/citations";
import { applyCanvasProposal } from "@/lib/canvas/apply-proposal";

export function ProposalList({
  proposals,
  citations,
  editor,
}: {
  proposals: CanvasProposal[];
  citations: Citation[];
  editor: Editor | null;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = proposals.filter((proposal) => !hidden.includes(proposalKey(proposal)));
  if (visible.length === 0) return null;
  return (
    <div className="mt-4 grid gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Proposed canvas edits
      </p>
      {visible.map((proposal) => (
        <article key={proposalKey(proposal)} className="rounded-xl border border-accent/30 bg-accent/10 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            {proposal.action === "create" ? "Add" : "Update"} {proposal.kind}
          </p>
          <h3 className="mt-1 text-sm font-medium">{proposal.title}</h3>
          <p className="mt-1 text-sm leading-6">{proposal.description}</p>
          {proposal.reason ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{proposal.reason}</p> : null}
          <CitationLine ids={proposal.citationIds} citations={citations} />
          <Button
            variant="accent"
            className="mt-3"
            disabled={!editor}
            onClick={() => {
              if (!editor) return;
              const applied = applyCanvasProposal(editor, proposal);
              if (!applied) {
                toast.error("That block is no longer on the canvas.");
                return;
              }
              setHidden((current) => [...current, proposalKey(proposal)]);
              toast.success(proposal.action === "create" ? "Added to the canvas" : "Canvas updated");
            }}
          >
            Apply to canvas
          </Button>
        </article>
      ))}
    </div>
  );
}

export function CitationLine({ ids, citations }: { ids: string[]; citations: Citation[] }) {
  const matches = ids.flatMap((id) => {
    const citation = citations.find((item) => item.id === id);
    return citation ? [citation] : [];
  });
  if (matches.length === 0) return null;
  return (
    <p className="mt-2 text-xs leading-5 text-muted-foreground">
      {matches.map((citation, index) => (
        <span key={citation.id}>
          {index > 0 ? " · " : "Sources: "}
          <a className="text-accent hover:underline" href={citation.url} target="_blank" rel="noreferrer">
            {citation.domain}
          </a>
        </span>
      ))}
    </p>
  );
}

function proposalKey(proposal: CanvasProposal) {
  return `${proposal.action}:${proposal.blockId ?? proposal.title}:${proposal.description}`;
}
