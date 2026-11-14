"use client";

import {
  ArrowUpRight,
  Circle,
  Hand,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { GeoShapeGeoStyle, createShapeId, type Editor } from "tldraw";
import { Hint } from "@/components/ui";
import { BLOCK_ICONS } from "@/lib/canvas/block-icons";
import { BLOCK_META, FORMA_BLOCK_TYPE, blockInk, type BlockKind } from "@/lib/canvas/kinds";
import type { CanvasUi } from "@/components/workspace/canvas-stage";

const TOOLS: { id: string; label: string; shortcut?: string; icon: LucideIcon; geo?: string }[] = [
  { id: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { id: "hand", label: "Pan", shortcut: "H", icon: Hand },
  { id: "draw", label: "Draw", shortcut: "D", icon: Pencil },
  { id: "note", label: "Sticky note", shortcut: "N", icon: StickyNote },
  { id: "geo", label: "Rectangle", shortcut: "R", icon: Square, geo: "rectangle" },
  { id: "geo", label: "Ellipse", shortcut: "O", icon: Circle, geo: "ellipse" },
  { id: "arrow", label: "Arrow", shortcut: "A", icon: ArrowUpRight },
  { id: "text", label: "Text", shortcut: "T", icon: Type },
];

const BLOCKS: BlockKind[] = ["screen", "service", "database", "entity", "decision", "note"];

export function LeftToolbar({ editor, ui }: { editor: Editor | null; ui: CanvasUi }) {
  return (
    <div className="pointer-events-none absolute bottom-48 left-3 top-3 z-20 flex items-center @min-[840px]:bottom-28">
      <div className="pointer-events-auto flex max-h-full flex-col gap-1 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-panel">
        {TOOLS.slice(0, 2).map((tool) => (
          <ToolButton key={tool.label} tool={tool} editor={editor} ui={ui} />
        ))}
        <span className="mx-1 my-1 h-px bg-border" />
        {TOOLS.slice(2).map((tool) => (
          <ToolButton key={tool.label} tool={tool} editor={editor} ui={ui} />
        ))}
        <span className="mx-1 my-1 h-px bg-border" />
        {BLOCKS.map((kind) => {
          const Icon = BLOCK_ICONS[kind];
          return (
            <Hint key={kind} label={BLOCK_META[kind].label}>
              <button
                type="button"
                aria-label={`Place ${BLOCK_META[kind].label}`}
                disabled={!editor}
                onClick={() => editor && placeBlock(editor, kind)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                <Icon className="h-4 w-4" style={{ color: blockInk(BLOCK_META[kind].color) }} />
              </button>
            </Hint>
          );
        })}
        <span className="mx-1 my-1 h-px bg-border" />
        <Hint label="Delete" shortcut="⌫">
          <button
            type="button"
            aria-label="Delete selection"
            disabled={!editor || ui.selectedCount === 0}
            onClick={() => editor && deleteSelection(editor)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-hover hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </Hint>
      </div>
    </div>
  );
}

function ToolButton({
  tool,
  editor,
  ui,
}: {
  tool: (typeof TOOLS)[number];
  editor: Editor | null;
  ui: CanvasUi;
}) {
  const active = tool.geo ? ui.tool === "geo" && ui.geo === tool.geo : ui.tool === tool.id;
  return (
    <Hint label={tool.label} shortcut={tool.shortcut}>
      <button
        type="button"
        aria-label={tool.label}
        aria-pressed={active}
        disabled={!editor}
        onClick={() => editor && selectTool(editor, tool.id, tool.geo)}
        className={`flex h-8 w-8 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 ${
          active ? "bg-accent-soft text-accent" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        }`}
      >
        <tool.icon className="h-4 w-4" />
      </button>
    </Hint>
  );
}

function selectTool(editor: Editor, id: string, geo?: string) {
  editor.run(() => {
    if (geo) editor.setStyleForNextShapes(GeoShapeGeoStyle, geo as "rectangle");
    editor.setCurrentTool(id);
  });
}

function deleteSelection(editor: Editor) {
  const selected = editor.getSelectedShapeIds();
  if (selected.length === 0) return;
  const selectedIds = new Set(selected);
  const attachedArrows = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.type === "arrow")
    .filter((shape) =>
      editor.getBindingsFromShape(shape.id, "arrow").some((binding) => selectedIds.has(binding.toId)),
    )
    .map((shape) => shape.id);
  editor.deleteShapes([...selected, ...attachedArrows]);
}

function placeBlock(editor: Editor, kind: BlockKind) {
  const bounds = editor.getViewportPageBounds();
  const w = 248;
  const h = 132;
  const offset = (editor.getCurrentPageShapes().length % 5) * 18;
  const id = createShapeId();
  editor.createShape({
    id,
    type: FORMA_BLOCK_TYPE,
    x: bounds.midX - w / 2 + offset,
    y: bounds.midY - h / 2 + offset,
    props: {
      kind,
      title: BLOCK_META[kind].defaultTitle,
      description: "",
      w,
      h,
    },
  });
  editor.select(id);
  editor.setCurrentTool("select");
}
