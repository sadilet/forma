"use client";

import type { Editor, TLShape } from "tldraw";
import type { CanvasSnapshot } from "@/lib/ai/schemas";
import { isFormaBlock } from "@/lib/canvas/forma-block-view";

export function extractCanvas(editor: Editor): CanvasSnapshot {
  const shapes = editor.getCurrentPageShapes();
  const blocks = shapes.filter(isFormaBlock).map((shape) => ({
    id: shape.id,
    kind: shape.props.kind,
    title: shape.props.title,
    description: shape.props.description,
  }));
  const titles = new Map(blocks.map((block) => [block.id, block.title]));

  const connections = shapes.flatMap((shape) => {
    if (shape.type !== "arrow") return [];
    const bindings = editor.getBindingsFromShape(shape.id, "arrow");
    const start = bindings.find((binding) => binding.props.terminal === "start");
    const end = bindings.find((binding) => binding.props.terminal === "end");
    if (!start || !end) return [];
    return [
      {
        id: shape.id,
        fromId: start.toId,
        toId: end.toId,
        fromTitle: titles.get(start.toId) ?? "Sketch",
        toTitle: titles.get(end.toId) ?? "Sketch",
        label: plainText(shape),
      },
    ];
  });

  const sketches: CanvasSnapshot["sketches"] = shapes.flatMap((shape) => {
    if (shape.type === "forma-block" || shape.type === "arrow" || shape.type === "draw") return [];
    if (shape.type !== "text" && shape.type !== "note" && shape.type !== "geo") return [];
    const text = plainText(shape);
    if (!text) return [];
    return [{ id: shape.id, type: shape.type, text: text.slice(0, 280) }];
  });

  const strokes = shapes.filter((shape) => shape.type === "draw").length;
  if (strokes > 0) {
    sketches.push({
      id: "freehand",
      type: "freehand",
      text: `${strokes} freehand stroke${strokes === 1 ? "" : "s"}`,
    });
  }

  return { blocks, connections, sketches };
}

function plainText(shape: TLShape) {
  const props = shape.props as { richText?: unknown; text?: unknown };
  if (typeof props.text === "string") return props.text.trim();
  return richTextToPlain(props.richText).trim();
}

function richTextToPlain(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown };
  const own = typeof node.text === "string" ? node.text : "";
  const children = Array.isArray(node.content) ? node.content.map(richTextToPlain).join(" ") : "";
  return `${own} ${children}`.replace(/\s+/g, " ").trim();
}
