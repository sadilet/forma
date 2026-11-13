"use client";

import { useEffect, useState } from "react";
import type { Editor } from "tldraw";
import { TooltipProvider } from "@/components/ui";
import { AiSidebar } from "@/components/workspace/ai-sidebar";
import { BottomBar } from "@/components/workspace/bottom-bar";
import {
  CanvasStage,
  CollaborationRoom,
  useCanvasUi,
  type CanvasUi,
} from "@/components/workspace/canvas-stage";
import { LeftToolbar } from "@/components/workspace/left-toolbar";
import { LiveStatus } from "@/components/workspace/presence";
import { TopNav } from "@/components/workspace/top-nav";
import { FORMA_EXPLORE_EVENT } from "@/lib/canvas/forma-block-view";
import type { SessionUser } from "@/lib/auth";
import type { ProjectRecord } from "@/lib/projects";

export function Workspace(props: {
  user: SessionUser;
  project: ProjectRecord;
  collaborationEnabled: boolean;
  licenseKey?: string;
}) {
  if (props.collaborationEnabled) {
    return (
      <CollaborationRoom roomId={props.project.roomId}>
        <WorkspaceFrame user={props.user} project={props.project} licenseKey={props.licenseKey} live />
      </CollaborationRoom>
    );
  }
  return <WorkspaceFrame user={props.user} project={props.project} licenseKey={props.licenseKey} live={false} />;
}

function WorkspaceFrame({
  user,
  project,
  licenseKey,
  live,
}: {
  user: SessionUser;
  project: ProjectRecord;
  licenseKey?: string;
  live: boolean;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [mode, setMode] = useState<"architect" | "explorer">("architect");
  const ui = useCanvasUi(editor);

  useEffect(() => {
    const openExplorer = () => {
      setAiOpen(true);
      setMode("explorer");
    };
    window.addEventListener(FORMA_EXPLORE_EVENT, openExplorer);
    return () => window.removeEventListener(FORMA_EXPLORE_EVENT, openExplorer);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopNav
          user={user}
          project={project}
          live={live}
          aiOpen={aiOpen}
          onToggleAi={() => {
            setAiOpen((open) => {
              const next = !open;
              if (next && ui.block) setMode("explorer");
              if (next && !ui.block) setMode("architect");
              return next;
            });
          }}
        />
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <CanvasStage
              live={live}
              user={user}
              project={project}
              licenseKey={licenseKey}
              onEditor={setEditor}
            />
            <LeftToolbar editor={editor} ui={ui} />
            <BottomBar
              editor={editor}
              ui={ui}
              status={
                live ? (
                  <LiveStatus />
                ) : (
                  <span className="whitespace-nowrap text-xs text-muted-foreground" title="Add LIVEBLOCKS_SECRET_KEY to collaborate across browsers.">
                    Solo · this browser
                  </span>
                )
              }
            />
            {project.template === "blank" && ui.shapeCount === 0 ? <EmptyHint /> : null}
          </div>
          <AiSidebar
            open={aiOpen}
            mode={mode}
            onMode={setMode}
            onClose={() => setAiOpen(false)}
            editor={editor}
            ui={ui}
            project={project}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium">Start with a component</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Place a screen, service, or note from the left toolbar. Draw freely around it.
        </p>
      </div>
    </div>
  );
}

export type { CanvasUi };
