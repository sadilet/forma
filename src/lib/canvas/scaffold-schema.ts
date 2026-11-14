import { z } from "zod";
import { BLOCK_KINDS } from "./kinds.ts";

// A first-pass product map from a one-liner such as "I want a booking app for barbers".
// Keys are local to the plan so links can name blocks before they exist on the canvas.

export const scaffoldBlockSchema = z.object({
  key: z.string(),
  kind: z.enum(BLOCK_KINDS),
  title: z.string(),
  description: z.string(),
  // 0 = people/entities, 1 = screens, 2 = services/decisions, 3 = data.
  column: z.number().int(),
  row: z.number().int(),
});

export const scaffoldLinkSchema = z.object({
  fromKey: z.string(),
  toKey: z.string(),
  label: z.string(),
});

export const scaffoldPlanSchema = z.object({
  goal: z.string(),
  summary: z.string(),
  blocks: z.array(scaffoldBlockSchema),
  links: z.array(scaffoldLinkSchema),
});

export type ScaffoldBlock = z.infer<typeof scaffoldBlockSchema>;
export type ScaffoldLink = z.infer<typeof scaffoldLinkSchema>;
export type ScaffoldPlan = z.infer<typeof scaffoldPlanSchema>;

const COL_GAP = 300;
const ROW_GAP = 176;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;
const BLOCK_W = 248;
const BLOCK_H = 140;

export function blockSize() {
  return { w: BLOCK_W, h: BLOCK_H };
}

// Place blocks on a simple grid from their column/row. Duplicate cells stack with a small offset.
export function layoutScaffold(blocks: ScaffoldBlock[]): Record<string, { x: number; y: number }> {
  const taken = new Map<string, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  for (const block of blocks) {
    const cell = `${block.column}:${block.row}`;
    const stack = taken.get(cell) ?? 0;
    taken.set(cell, stack + 1);
    positions[block.key] = {
      x: ORIGIN_X + block.column * COL_GAP + stack * 16,
      y: ORIGIN_Y + block.row * ROW_GAP + stack * 12,
    };
  }
  return positions;
}

// Drop links that point at missing keys, and collapse duplicate keys by keeping the first block.
export function normalizeScaffold(plan: ScaffoldPlan): ScaffoldPlan {
  const seen = new Set<string>();
  const blocks = plan.blocks
    .flatMap((block) => {
      const key = block.key.trim();
      if (!key || seen.has(key) || !block.title.trim()) return [];
      seen.add(key);
      return [
        {
          ...block,
          key,
          title: block.title.trim().slice(0, 80),
          description: block.description.trim().slice(0, 400),
          column: Number.isFinite(block.column) ? Math.min(3, Math.max(0, Math.trunc(block.column))) : 1,
          row: Number.isFinite(block.row) ? Math.min(8, Math.max(0, Math.trunc(block.row))) : 0,
        },
      ];
    })
    .slice(0, 14);
  const keys = new Set(blocks.map((block) => block.key));
  const links = plan.links
    .filter((link) => keys.has(link.fromKey) && keys.has(link.toKey) && link.fromKey !== link.toKey)
    .slice(0, 20);
  return {
    goal: plan.goal.trim().slice(0, 400),
    summary: plan.summary.trim().slice(0, 800),
    blocks,
    links,
  };
}
