"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { Editor } from "tldraw";
import { DeployDock } from "@/components/deploy/deploy-dock";
import { TooltipProvider } from "@/components/ui";
import { AiSidebar } from "@/components/workspace/ai-sidebar";
import { CollabBridge, VoicePresence } from "@/components/workspace/collab-bridge";
import { ArchitectLiveProvider } from "@/components/workspace/architect/architect-live";
import { CommandBar } from "@/components/workspace/command-bar";
import { draftValue, receiveRemote, startDraft } from "@/lib/collab/draft";
import type { FormaRoomEvent, ResourceKind } from "@/lib/collab/events";
import { recordEvent, type SyncVersions } from "@/lib/collab/sync";
import { BottomBar } from "@/components/workspace/bottom-bar";
import { CanvasStage, CollaborationRoom, useCanvasUi, type CanvasUi } from "@/components/workspace/canvas-stage";
import { LeftToolbar } from "@/components/workspace/left-toolbar";
import { LiveStatus } from "@/components/workspace/presence";
import { TopNav } from "@/components/workspace/top-nav";
import { TAB_BLOCK_KEY, type ArchitectTab } from "@/lib/architect/tabs";
import { FORMA_EXPLORE_EVENT } from "@/lib/canvas/forma-block-view";
import type { VoiceState } from "@/lib/voice/gemini-live-client";
import { FORMA_NAVIGATE_EVENT } from "@/lib/voice/navigation";
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
  const [goal, setGoal] = useState(() => startDraft({ value: project.goal, version: null }));
  const [versions, setVersions] = useState<SyncVersions>({});
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceTab, setVoiceTab] = useState<ArchitectTab>("review");
  const [clearDevBadge, setClearDevBadge] = useState(false);
  const ui = useCanvasUi(editor);

  useEffect(() => {
    const update = () => setClearDevBadge(Boolean(document.querySelector("nextjs-portal")));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);

  function onCollab(event: FormaRoomEvent) {
    if (event.actorId === user.id) return;
    if (event.resource === "goal") {
      void fetch(`/api/project?projectId=${project.id}`)
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || typeof data.goal !== "string") return;
          const focused = document.activeElement?.id === "forma-goal";
          setGoal((current) =>
            receiveRemote(current, { value: data.goal, version: null }, focused || current.edits !== null),
          );
        })
        .catch(() => undefined);
    }
    if (event.resource !== "conversation") toast.message(event.summary);
    setVersions((current) => recordEvent(current, event));
  }

  // Gemini Live can open a tab while it talks. Tell the sidebar, and remember where spoken turns should be saved.
  function navigateTab(tab: ArchitectTab) {
    setAiOpen(true);
    setMode("architect");
    setVoiceTab(tab);
    window.dispatchEvent(new CustomEvent(FORMA_NAVIGATE_EVENT, { detail: tab }));
  }

  // Our own saves do not come back as room events, so bump the version here to refresh this browser's thread.
  function bump(resource: ResourceKind, blockId?: string) {
    setVersions((current) =>
      recordEvent(current, {
        type: "RESOURCE_UPDATED",
        resource,
        blockId,
        actorId: user.id,
        actorName: user.name,
        timestamp: Date.now(),
        summary: `${resource} updated`,
      }),
    );
  }

  function onVoiceSaved(blockKey: string) {
    bump("conversation", blockKey);
  }

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
      <ArchitectLiveProvider
        editor={editor}
        project={project}
        goal={draftValue(goal)}
        block={ui.block}
        onOpenTab={navigateTab}
        onChanged={bump}
        onGoalSuggested={(value) =>
          setGoal((current) => (current.edits !== null ? current : startDraft({ value, version: null })))
        }
      >
        <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background">
          {live ? <CollabBridge onEvent={onCollab} /> : null}
          {live ? <VoicePresence state={voiceState} /> : null}
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
            <div className="@container relative z-0 min-w-0 flex-1">
              <CanvasStage live={live} user={user} project={project} licenseKey={licenseKey} onEditor={setEditor} />
              <LeftToolbar editor={editor} ui={ui} />
              <DeployDock editor={editor} project={project} />
              <div className={`pointer-events-none absolute bottom-3 right-3 z-30 flex flex-wrap items-end gap-x-3 gap-y-2 sm:right-[7.5rem] ${clearDevBadge ? "left-16" : "left-3"}`}>
                <BottomBar
                  editor={editor}
                  ui={ui}
                  status={
                    live ? (
                      <LiveStatus />
                    ) : (
                      <span
                        className="whitespace-nowrap text-xs text-muted-foreground"
                        title="Add LIVEBLOCKS_SECRET_KEY to collaborate across browsers."
                      >
                        Solo · this browser
                      </span>
                    )
                  }
                />
                <div className="flex min-w-[min(100%,20rem)] flex-1 justify-center">
                  <div className="pointer-events-auto w-full max-w-[42rem]">
                    <CommandBar
                      editor={editor}
                      project={project}
                      goal={draftValue(goal)}
                      conversationKey={aiOpen && mode === "explorer" && ui.block ? ui.block.id : TAB_BLOCK_KEY[voiceTab]}
                      onNavigateTab={navigateTab}
                      onOpenTab={navigateTab}
                      onVoiceState={setVoiceState}
                      onConversationSaved={onVoiceSaved}
                    />
                  </div>
                </div>
              </div>
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
              live={live}
              goal={goal}
              setGoal={setGoal}
              versions={versions}
            />
          </div>
        </div>
      </ArchitectLiveProvider>
    </TooltipProvider>
  );
}

function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium">Describe the product, or place a component</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Ask for something like “I want a booking app for barbers” in the bar below, or place a screen from the left toolbar.
        </p>
      </div>
    </div>
  );
}

export type { CanvasUi };
