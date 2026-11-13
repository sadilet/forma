"use client";

import {
  AppWindow,
  ArrowUpRight,
  Circle,
  Database,
  FileText,
  GitBranch,
  Hand,
  MousePointer2,
  Pencil,
  Server,
  Square,
  StickyNote,
  Trash2,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { GeoShapeGeoStyle, createShapeId, type Editor } from "tldraw";
import { Hint } from "@/components/ui";
import { BLOCK_META, FORMA_BLOCK_TYPE, type BlockKind } from "@/lib/canvas/kinds";
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

const BLOCKS: { kind: BlockKind; icon: LucideIcon }[] = [
  { kind: "screen", icon: AppWindow },
  { kind: "service", icon: Server },
  { kind: "database", icon: Database },
  { kind: "entity", icon: UserRound },
  { kind: "decision", icon: GitBranch },
  { kind: "note", icon: FileText },
];

export function LeftToolbar({ editor, ui }: { editor: Editor | null; ui: CanvasUi }) {
  return (
    <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2">
      <div className="pointer-events-auto flex max-h-[calc(100vh-8rem)] flex-col gap-1 overflow-y-auto rounded-2xl border border-border bg-[#14161b]/95 p-1.5 shadow-xl backdrop-blur">
        {TOOLS.slice(0, 2).map((tool) => (
          <ToolButton key={tool.label} tool={tool} editor={editor} ui={ui} />
        ))}
        <span className="mx-1 my-1 h-px bg-white/10" />
        {TOOLS.slice(2).map((tool) => (
          <ToolButton key={tool.label} tool={tool} editor={editor} ui={ui} />
        ))}
        <span className="mx-1 my-1 h-px bg-white/10" />
        {BLOCKS.map((block) => (
          <Hint key={block.kind} label={BLOCK_META[block.kind].label}>
            <button
              type="button"
              aria-label={`Place ${BLOCK_META[block.kind].label}`}
              disabled={!editor}
              onClick={() => editor && placeBlock(editor, block.kind)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-40"
              style={{ color: undefined }}
            >
              <block.icon className="h-4 w-4" style={{ color: BLOCK_META[block.kind].color }} />
            </button>
          </Hint>
        ))}
        <span className="mx-1 my-1 h-px bg-white/10" />
        <Hint label="Delete" shortcut="⌫">
          <button
            type="button"
            aria-label="Delete selection"
            disabled={!editor || ui.selectedCount === 0}
            onClick={() => editor && deleteSelection(editor)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/8 hover:text-[#f0a3a8] disabled:opacity-40"
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
        className={`flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40 ${
          active ? "bg-white/12 text-foreground" : "text-muted-foreground hover:bg-white/8 hover:text-foreground"
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
