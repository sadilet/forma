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
    <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1 shadow-panel">
        <BarButton label="Zoom out" disabled={!editor} onClick={() => editor?.zoomOut(undefined, { animation: { duration: 160 } })}>
          <Minus className="h-3.5 w-3.5" />
        </BarButton>
        <button
          type="button"
          disabled={!editor}
          onClick={() => editor?.resetZoom(undefined, { animation: { duration: 160 } })}
          className="min-w-12 rounded-full px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
        >
          {ui.zoom}%
        </button>
        <BarButton label="Zoom in" disabled={!editor} onClick={() => editor?.zoomIn(undefined, { animation: { duration: 160 } })}>
          <Plus className="h-3.5 w-3.5" />
        </BarButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <BarButton label="Fit to content" disabled={!editor} onClick={() => editor?.zoomToFit({ animation: { duration: 220 } })}>
          <Scan className="h-3.5 w-3.5" />
        </BarButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="px-2">{status}</span>
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
      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
    >
      {children}
    </button>
  );
}
