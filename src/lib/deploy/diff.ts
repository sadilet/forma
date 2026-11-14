import type { CanvasSnapshot } from "../ai/schemas.ts";

// Says in words what changed on the canvas between two deploys, so the app builder can update the app
// it already wrote instead of writing a new one. An empty list means nothing that matters changed.

export type CanvasState = { snapshot: CanvasSnapshot; goal: string };

const clip = (value: string, length = 280) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

export function describeChanges(before: CanvasState, after: CanvasState): string[] {
  const lines: string[] = [];

  if (before.goal.trim() !== after.goal.trim()) {
    lines.push(`The product goal changed. It was "${clip(before.goal)}" and is now "${clip(after.goal)}".`);
  }

  const oldBlocks = new Map(before.snapshot.blocks.map((block) => [block.id, block]));
  const newBlocks = new Map(after.snapshot.blocks.map((block) => [block.id, block]));
  for (const block of after.snapshot.blocks) {
    const old = oldBlocks.get(block.id);
    if (!old) {
      lines.push(`Added ${block.kind} "${block.title}": ${clip(block.description) || "no description"}`);
      continue;
    }
    const parts: string[] = [];
    if (old.kind !== block.kind) parts.push(`it is now a ${block.kind} (was a ${old.kind})`);
    if (old.title !== block.title) parts.push(`it was renamed from "${old.title}"`);
    if (old.description.trim() !== block.description.trim()) {
      parts.push(`its description was "${clip(old.description)}" and is now "${clip(block.description)}"`);
    }
    if (parts.length > 0) lines.push(`Changed ${block.kind} "${block.title}": ${parts.join("; ")}.`);
  }
  for (const block of before.snapshot.blocks) {
    if (!newBlocks.has(block.id)) lines.push(`Removed ${block.kind} "${block.title}".`);
  }

  const key = (edge: CanvasSnapshot["connections"][number]) => `${edge.fromId}>${edge.toId}>${edge.label.trim()}`;
  const oldEdges = new Set(before.snapshot.connections.map(key));
  const newEdges = new Set(after.snapshot.connections.map(key));
  const describe = (edge: CanvasSnapshot["connections"][number]) =>
    `"${edge.fromTitle}" to "${edge.toTitle}"${edge.label.trim() ? ` (${clip(edge.label, 80)})` : ""}`;
  for (const edge of after.snapshot.connections) {
    if (!oldEdges.has(key(edge))) lines.push(`Added arrow ${describe(edge)}.`);
  }
  for (const edge of before.snapshot.connections) {
    if (!newEdges.has(key(edge))) lines.push(`Removed arrow ${describe(edge)}.`);
  }

  const oldSketches = new Map(before.snapshot.sketches.map((sketch) => [sketch.id, sketch]));
  const newSketches = new Map(after.snapshot.sketches.map((sketch) => [sketch.id, sketch]));
  for (const sketch of after.snapshot.sketches) {
    const old = oldSketches.get(sketch.id);
    if (!old) lines.push(`Added sketch text: "${clip(sketch.text)}".`);
    else if (old.text.trim() !== sketch.text.trim()) lines.push(`Sketch text changed from "${clip(old.text)}" to "${clip(sketch.text)}".`);
  }
  for (const sketch of before.snapshot.sketches) {
    if (!newSketches.has(sketch.id)) lines.push(`Removed sketch text: "${clip(sketch.text)}".`);
  }

  return lines;
}
