"use client";

import { useEditor, type TLShape } from "tldraw";
import { BLOCK_META, FORMA_BLOCK_TYPE, type BlockKind } from "@/lib/canvas/kinds";

export const FORMA_EXPLORE_EVENT = "forma-explore";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [FORMA_BLOCK_TYPE]: {
      w: number;
      h: number;
      kind: BlockKind;
      title: string;
      description: string;
    };
  }
}

export type FormaBlockShape = TLShape<typeof FORMA_BLOCK_TYPE>;

export function isFormaBlock(shape: TLShape): shape is FormaBlockShape {
  return shape.type === FORMA_BLOCK_TYPE;
}

export function FormaBlockCard({ shape }: { shape: FormaBlockShape }) {
  const editor = useEditor();
  const meta = BLOCK_META[shape.props.kind] ?? BLOCK_META.note;

  return (
    <div
      className="forma-block"
      style={{ borderColor: `${meta.color}55`, width: "100%", height: "100%" }}
    >
      <span className="forma-block-accent" style={{ background: meta.color }} />
      <div className="forma-block-body">
        <div className="forma-block-kicker" style={{ color: meta.color }}>
          {meta.label}
        </div>
        <div className="forma-block-title">{shape.props.title || "Untitled"}</div>
        <div className="forma-block-copy">
          {shape.props.description || "Add a description from the architect."}
        </div>
      </div>
      <button
        type="button"
        className="forma-block-explore"
        onPointerDown={(event) => {
          event.stopPropagation();
          editor.select(shape.id);
          window.dispatchEvent(new CustomEvent(FORMA_EXPLORE_EVENT, { detail: shape.id }));
        }}
      >
        Explore
      </button>
    </div>
  );
}
