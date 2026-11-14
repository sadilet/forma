"use client";

import { LiveMap, LiveObject, type JsonObject } from "@liveblocks/client";
import { ClientSideSuspense, LiveblocksProvider, RoomProvider, useRoom } from "@liveblocks/react/suspense";
import { Component, useEffect, useMemo, useState } from "react";
import {
  GeoShapeGeoStyle,
  Tldraw,
  type Editor,
  type TLComponents,
  type TLStore,
} from "tldraw";
import "tldraw/tldraw.css";
import "@/lib/liveblocks.config";
import { FormaBlockShapeUtil } from "@/lib/canvas/forma-block-util";
import { isFormaBlock, type FormaBlockShape } from "@/lib/canvas/forma-block-view";
import { canvasNeedsMeetingsSeed, seedMeetings } from "@/lib/canvas/meetings";
import { canvasNeedsSlotguardSeed, seedSlotguard } from "@/lib/canvas/slotguard";
import { canvasNeedsTaskflowSeed, seedTaskflow } from "@/lib/canvas/taskflow";
import { useStorageStore } from "@/lib/canvas/use-storage-store";
import type { SessionUser } from "@/lib/auth";
import type { ProjectRecord } from "@/lib/projects";

const SHAPE_UTILS = [FormaBlockShapeUtil];

const TEMPLATE_SEEDS = {
  taskflow: { needsSeed: canvasNeedsTaskflowSeed, seed: seedTaskflow },
  meetings: { needsSeed: canvasNeedsMeetingsSeed, seed: seedMeetings },
  slotguard: { needsSeed: canvasNeedsSlotguardSeed, seed: seedSlotguard },
} as const;

type SeededTemplate = keyof typeof TEMPLATE_SEEDS;

function seededTemplate(template: ProjectRecord["template"]): SeededTemplate | null {
  return template in TEMPLATE_SEEDS ? (template as SeededTemplate) : null;
}

const CANVAS_COMPONENTS: TLComponents = {
  Toolbar: null,
  MainMenu: null,
  PageMenu: null,
  NavigationPanel: null,
  StylePanel: null,
  HelpMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  Minimap: null,
  MenuPanel: null,
  TopPanel: null,
  SharePanel: null,
  HelperButtons: null,
  DebugMenu: null,
  DebugPanel: null,
  ZoomMenu: null,
  KeyboardShortcutsDialog: null,
  ImageToolbar: null,
  VideoToolbar: null,
  PeopleMenu: null,
  FollowingIndicator: null,
  CursorChatBubble: null,
};

export type CanvasUi = {
  zoom: number;
  tool: string;
  geo: string;
  block: FormaBlockShape | null;
  shapeCount: number;
  selectedCount: number;
};

export function useCanvasUi(editor: Editor | null): CanvasUi {
  const [ui, setUi] = useState<CanvasUi>({
    zoom: 100,
    tool: "select",
    geo: "rectangle",
    block: null,
    shapeCount: 0,
    selectedCount: 0,
  });

  useEffect(() => {
    if (!editor) return;
    const publish = () => {
      const block = editor.getSelectedShapes().find(isFormaBlock) ?? null;
      const zoom = Math.round(editor.getZoomLevel() * 100);
      const tool = editor.getCurrentToolId();
      let geo = "rectangle";
      try {
        geo = String(editor.getStyleForNextShape(GeoShapeGeoStyle));
      } catch {
        geo = "rectangle";
      }
      const shapeCount = editor.getCurrentPageShapes().length;
      const selectedCount = editor.getSelectedShapeIds().length;
      setUi((current) => {
        if (
          current.zoom === zoom &&
          current.tool === tool &&
          current.geo === geo &&
          current.shapeCount === shapeCount &&
          current.selectedCount === selectedCount &&
          current.block?.id === block?.id &&
          current.block?.props.title === block?.props.title &&
          current.block?.props.description === block?.props.description &&
          current.block?.props.kind === block?.props.kind
        ) {
          return current;
        }
        return { zoom, tool, geo, block, shapeCount, selectedCount };
      });
    };
    publish();
    const unsubs = [
      editor.store.listen(publish, { scope: "session" }),
      editor.store.listen(publish, { scope: "document" }),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [editor]);

  return ui;
}

export function CanvasStage({
  live,
  user,
  project,
  licenseKey,
  onEditor,
}: {
  live: boolean;
  user: SessionUser;
  project: ProjectRecord;
  licenseKey?: string;
  onEditor: (editor: Editor | null) => void;
}) {
  if (live) {
    return <CollaborativeCanvas user={user} project={project} licenseKey={licenseKey} onEditor={onEditor} />;
  }
  return (
    <TldrawSurface
      persistenceKey={`forma-${project.id}`}
      licenseKey={licenseKey}
      onMount={(editor) => {
        prepareEditor(editor, user);
        onEditor(editor);
        const template = seededTemplate(project.template);
        if (template) TEMPLATE_SEEDS[template].seed(editor);
      }}
      onUnmount={() => onEditor(null)}
    />
  );
}

function CollaborativeCanvas({
  user,
  project,
  licenseKey,
  onEditor,
}: {
  user: SessionUser;
  project: ProjectRecord;
  licenseKey?: string;
  onEditor: (editor: Editor | null) => void;
}) {
  const room = useRoom();
  const store = useStorageStore({
    shapeUtils: SHAPE_UTILS,
    user: { id: user.id, name: user.name, color: user.color },
  });

  if (store.status === "loading") return <CanvasMessage title="Syncing the canvas" />;
  if (store.status === "error" || !store.store) {
    return (
      <CanvasMessage
        title="The canvas could not sync"
        detail={store.status === "error" ? store.error.message : "Liveblocks did not return a store."}
      />
    );
  }

  return (
    <TldrawSurface
      store={store.store}
      licenseKey={licenseKey}
      onMount={(editor) => {
        prepareEditor(editor, user);
        onEditor(editor);
        const template = seededTemplate(project.template);
        if (template && room) void seedSharedTemplate(room, editor, template);
      }}
      onUnmount={() => onEditor(null)}
    />
  );
}

function TldrawSurface({
  store,
  persistenceKey,
  licenseKey,
  onMount,
  onUnmount,
}: {
  store?: TLStore;
  persistenceKey?: string;
  licenseKey?: string;
  onMount: (editor: Editor) => void;
  onUnmount: () => void;
}) {
  const shared = {
    shapeUtils: SHAPE_UTILS,
    components: CANVAS_COMPONENTS,
    colorScheme: "dark" as const,
    licenseKey,
    autoFocus: false,
    options: { maxPages: 1 },
    onMount: (editor: Editor) => {
      onMount(editor);
      return onUnmount;
    },
  };

  return (
    <div className="forma-canvas absolute inset-0">
      {store ? <Tldraw store={store} {...shared} /> : <Tldraw persistenceKey={persistenceKey} {...shared} />}
    </div>
  );
}

function prepareEditor(editor: Editor, user: SessionUser) {
  editor.user.updateUserPreferences({
    id: user.id,
    name: user.name,
    color: user.color,
    colorScheme: "dark",
  });
  editor.updateInstanceState({ isGridMode: true });
}

async function seedSharedTemplate(
  room: NonNullable<ReturnType<typeof useRoom>>,
  editor: Editor,
  template: SeededTemplate,
) {
  if (!room) return;
  const { needsSeed, seed } = TEMPLATE_SEEDS[template];
  const fit = () => {
    // The camera is local to each client, so a demo canvas that is already seeded opens at 100%. Fit it instead.
    if (editor.getCurrentPageShapeIds().size > 0) editor.zoomToFit({ animation: { duration: 0 } });
  };
  const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  await wait(400);
  const { root } = await room.getStorage();
  // A room that someone already filled must not be seeded again. The seed helpers delete every shape
  // first, so two clients seeding at once makes the canvas flash empty and redraw.
  if (root.get("seeded") === true || !needsSeed(editor)) {
    fit();
    return;
  }

  const selfId = room.getSelf()?.connectionId ?? 0;
  const leader = Math.min(selfId, ...room.getOthers().map((other) => other.connectionId));
  if (selfId !== leader) {
    // Wait for the leader's shapes to arrive. Never seed as a follower.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(250);
      if (root.get("seeded") === true || !needsSeed(editor)) break;
    }
    fit();
    return;
  }

  // Claim the room before drawing, so a second tab that also thinks it is the leader does not wipe it.
  if (root.get("seeded") === true) {
    fit();
    return;
  }
  root.set("seeded", true);
  seed(editor);
  fit();
}

export function CanvasMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#101114] px-6 text-center">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {detail ? <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

export function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div className="grid h-screen place-items-center bg-background">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export class WorkspaceErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-screen place-items-center bg-background px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Collaboration could not start</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{this.state.error.message}</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Check LIVEBLOCKS_SECRET_KEY, then restart the server. Forma will not invent cursors.
          </p>
        </div>
      </div>
    );
  }
}

export function useInitialStorage() {
  return useMemo(
    () => ({
      records: new LiveMap<string, LiveObject<JsonObject>>(),
      seeded: false,
    }),
    [],
  );
}

export function CollaborationRoom({
  roomId,
  children,
}: {
  roomId: string;
  children: React.ReactNode;
}) {
  const initialStorage = useInitialStorage();
  const initialPresence = useMemo(() => ({ presence: null }), []);
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider id={roomId} initialPresence={initialPresence} initialStorage={initialStorage}>
        <ClientSideSuspense fallback={<WorkspaceLoading label="Joining the workspace" />}>
          <WorkspaceErrorBoundary>{children}</WorkspaceErrorBoundary>
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}
