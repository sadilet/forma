"use client";

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { CanvasProposal } from "@/lib/ai/schemas";
import { FORMA_BLOCK_TYPE } from "@/lib/canvas/kinds";

export function applyCanvasProposal(editor: Editor, proposal: CanvasProposal) {
  if (proposal.action === "update" && proposal.blockId) {
    const shape = editor.getShape(proposal.blockId as TLShapeId);
    if (!shape || shape.type !== FORMA_BLOCK_TYPE) return false;
    editor.updateShape({
      id: shape.id,
      type: FORMA_BLOCK_TYPE,
      props: { description: proposal.description },
    });
    editor.select(shape.id);
    editor.zoomToSelection({ animation: { duration: 220 } });
    return true;
  }

  const kind = proposal.kind === "decision" ? "decision" : "note";
  const id = createShapeId();
  const bounds = editor.getViewportPageBounds();
  editor.createShape({
    id,
    type: FORMA_BLOCK_TYPE,
    x: bounds.midX - 80,
    y: bounds.midY - 40,
    props: {
      kind,
      title: proposal.title || (kind === "decision" ? "Decision" : "Note"),
      description: proposal.description,
      w: 260,
      h: 150,
    },
  });
  editor.select(id);
  editor.zoomToSelection({ animation: { duration: 220 } });
  return true;
}
