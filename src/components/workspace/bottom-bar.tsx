"use client";

import { Minus, Plus, Scan } from "lucide-react";
import type { Editor } from "tldraw";
import type { CanvasUi } from "@/components/workspace/canvas-stage";

export function BottomBar({
  editor,
  ui,
  status,
}: {
  editor: Editor | null;
  ui: CanvasUi;
  status: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex items-center justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-[#14161b]/95 px-1.5 py-1 shadow-xl backdrop-blur">
        <BarButton label="Zoom out" disabled={!editor} onClick={() => editor?.zoomOut(undefined, { animation: { duration: 160 } })}>
          <Minus className="h-3.5 w-3.5" />
        </BarButton>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.resetZoom(undefined, { animation: { duration: 160 } })}
          className="min-w-12 px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {ui.zoom}%
        </button>
        <BarButton label="Zoom in" disabled={!editor} onClick={() => editor?.zoomIn(undefined, { animation: { duration: 160 } })}>
          <Plus className="h-3.5 w-3.5" />
        </BarButton>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <BarButton label="Fit to content" disabled={!editor} onClick={() => editor?.zoomToFit({ animation: { duration: 220 } })}>
          <Scan className="h-3.5 w-3.5" />
        </BarButton>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <span className="px-2">{status}</span>
      </div>
    </div>
  );
}

function BarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}
