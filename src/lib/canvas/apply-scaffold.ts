"use client";

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { connect } from "@/lib/canvas/taskflow";
import { blockSize, layoutScaffold, type ScaffoldPlan } from "@/lib/canvas/scaffold-schema";
import { FORMA_BLOCK_TYPE } from "@/lib/canvas/kinds";

// Turn a scaffold plan into real canvas shapes. Voice and the omnibar both call this in the browser.

export function applyScaffold(
  editor: Editor,
  plan: ScaffoldPlan,
  options?: { replace?: boolean },
): { blockCount: number; linkCount: number } {
  const positions = layoutScaffold(plan.blocks);
  const size = blockSize();
  const ids = new Map<string, TLShapeId>();

  editor.run(() => {
    if (options?.replace) {
      const existing = editor.getCurrentPageShapes().map((shape) => shape.id);
      if (existing.length) editor.deleteShapes(existing);
    }

    for (const block of plan.blocks) {
      const id = createShapeId();
      const spot = positions[block.key] ?? { x: 80, y: 80 };
      ids.set(block.key, id);
      editor.createShape({
        id,
        type: FORMA_BLOCK_TYPE,
        x: spot.x,
        y: spot.y,
        props: {
          kind: block.kind,
          title: block.title,
          description: block.description,
          w: size.w,
          h: size.h,
        },
      });
    }

    for (const link of plan.links) {
      const from = ids.get(link.fromKey);
      const to = ids.get(link.toKey);
      if (!from || !to) continue;
      connect(editor, from, to, link.label.trim() || "uses");
    }
  });

  editor.zoomToFit({ animation: { duration: 280 } });
  editor.selectNone();
  return { blockCount: plan.blocks.length, linkCount: plan.links.length };
}
