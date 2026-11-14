"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import type { Editor } from "tldraw";
import { describeSpecification } from "@/lib/ai/prompt";
import { looksLikeScaffoldBrief } from "@/lib/ai/decision";
import { isArchitectTab, type ArchitectTab } from "@/lib/architect/tabs";
import { extractCanvas } from "@/lib/canvas/extract";
import { applyScaffold } from "@/lib/canvas/apply-scaffold";
import { isFormaBlock } from "@/lib/canvas/forma-block-view";
import type { ScaffoldPlan } from "@/lib/canvas/scaffold-schema";
import { BLOCK_META } from "@/lib/canvas/kinds";
import { cn } from "@/lib/utils";
import {
  GeminiLiveClient,
  type ConnectionState,
  type LiveSessionTicket,
  type ToolCall,
  type VoiceState,
} from "@/lib/voice/gemini-live-client";
import { CONTEXT_SCOPES, isLookupKind, type VoiceToolName } from "@/lib/voice/protocol";
import type { ChatMessage, Specification } from "@/lib/ai/schemas";
import type { ProjectRecord } from "@/lib/projects";

const FRAME_DEBOUNCE_MS = 1500;

export function VoiceControl({
  editor,
  project,
  goal,
  conversationKey,
  onNavigateTab,
  onVoiceState,
  onConversationSaved,
  className,
}: {
  editor: Editor | null;
  project: ProjectRecord;
  goal: string;
  // Where finished spoken turns are saved: the selected component's thread, or the active tab's thread.
  conversationKey: string;
  onNavigateTab: (tab: ArchitectTab) => void;
  onVoiceState: (state: VoiceState) => void;
  onConversationSaved: (blockKey: string) => void;
  className?: string;
}) {
  const [connection, setConnection] = useState<ConnectionState>("off");
  const [voice, setVoice] = useState<VoiceState>("idle");
  const editorRef = useRef(editor);
  const keyRef = useRef(conversationKey);
  const navigateRef = useRef(onNavigateTab);
  const savedRef = useRef(onConversationSaved);
  const voiceStateRef = useRef(onVoiceState);
  const stopFramesRef = useRef<(() => void) | null>(null);
  // Stops the model tool and the transcript fallback from drafting the canvas twice.
  const scaffoldingRef = useRef(false);

  useEffect(() => {
    editorRef.current = editor;
    keyRef.current = conversationKey;
    navigateRef.current = onNavigateTab;
    savedRef.current = onConversationSaved;
    voiceStateRef.current = onVoiceState;
  });

  const draftFromBrief = useCallback(
    async (brief: string, replace = false) => {
      const current = editorRef.current;
      if (!current || scaffoldingRef.current) return { ok: false as const, skipped: true };
      scaffoldingRef.current = true;
      try {
        toast.message("Drafting the canvas…");
        const result = await scaffoldCanvas(current, project.id, { brief, replace });
        if (result.ok) {
          toast.success(`Placed ${result.blockCount} components on the canvas`);
          navigateRef.current("review");
        } else if (result.notice) {
          toast.message(result.notice);
        }
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Could not draft that canvas.";
        toast.error(message);
        throw caught;
      } finally {
        scaffoldingRef.current = false;
      }
    },
    [project.id],
  );

  const runTool = useCallback(
    async (call: ToolCall) => {
      const current = editorRef.current;
      if (!current) throw new Error("The canvas is not ready yet.");
      const name = call.name as VoiceToolName;
      if (name === "get_canvas_details") return canvasDetails(current, project.id);
      if (name === "get_workspace_context") return workspaceContext(project.id, call.args);
      if (name === "lookup_web") return lookupWeb(project.id, call.args);
      if (name === "scaffold_canvas") {
        const brief = readBrief(call.args);
        const replace = readFlag(call.args.replace);
        return draftFromBrief(brief, replace);
      }
      if (name === "navigate_workspace") return navigate(current, call.args, (tab) => navigateRef.current(tab));
      throw new Error(`Unknown tool ${call.name}.`);
    },
    [project.id, draftFromBrief],
  );

  // The client owns the microphone and a socket, so it lives in an effect and is torn down with the control.
  const [client, setClient] = useState<GeminiLiveClient | null>(null);
  useEffect(() => {
    const next = new GeminiLiveClient({
      onConnection: (state, detail) => {
        setConnection(state);
        if (state === "error" && detail) toast.error(detail);
        if (state !== "live") {
          stopFramesRef.current?.();
          stopFramesRef.current = null;
        }
      },
      onVoiceState: (state) => {
        setVoice(state);
        voiceStateRef.current(state);
      },
      onTranscript: (role, text) => {
        void saveTurn(project.id, keyRef.current, role, text, () => savedRef.current(keyRef.current));
        // Live often describes a product instead of calling the tool. On an empty canvas, draft as soon as we hear a brief.
        if (role === "user") {
          const current = editorRef.current;
          if (current && extractCanvas(current).blocks.length === 0 && looksLikeScaffoldBrief(text)) {
            void draftFromBrief(text, false).catch(() => undefined);
          }
        }
      },
      onToolCall: (call) => runTool(call),
    });
    setClient(next);
    return () => {
      stopFramesRef.current?.();
      stopFramesRef.current = null;
      next.stop();
    };
  }, [project.id, runTool, draftFromBrief]);

  async function begin() {
    const current = editorRef.current;
    if (!current || !client) return;
    setConnection("connecting");
    try {
      const response = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = (await response.json()) as LiveSessionTicket & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start a voice session.");
      await client.start(data, instructionsFor(project.name, goal, current));
      stopFramesRef.current = watchCanvas(current, client);
    } catch (caught) {
      client.stop();
      setConnection("error");
      toast.error(describeError(caught));
    }
  }

  function toggle() {
    if (!client) return;
    if (connection === "live" || connection === "connecting") {
      stopFramesRef.current?.();
      stopFramesRef.current = null;
      client.stop();
      return;
    }
    void begin();
  }

  const live = connection === "live";
  const label = live ? "End voice session" : connection === "connecting" ? "Connecting to Gemini Live" : "Talk with the architect";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!editor || !client || connection === "connecting"}
      aria-label={label}
      aria-pressed={live}
      title={live ? (voice === "speaking" ? "Gemini is speaking. Talk to interrupt." : "Listening. Click to end.") : label}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60",
        live
          ? "border-accent bg-accent text-accent-ink"
          : "border-border-strong bg-surface text-foreground shadow-panel hover:bg-surface-hover",
        live && voice === "listening" ? "forma-voice-live" : "",
        className,
      )}
    >
      {connection === "connecting" ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : live ? (
        <MicOff className="h-4 w-4" aria-hidden />
      ) : (
        <Mic className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

function instructionsFor(projectName: string, goal: string, editor: Editor) {
  const canvas = extractCanvas(editor);
  const blocks =
    canvas.blocks.length === 0
      ? "The canvas has no components yet."
      : canvas.blocks.map((block) => `- ${block.title} (${BLOCK_META[block.kind].label}) [${block.id}]`).join("\n");
  return [
    "You are Forma's product architect, talking with a team about the product on their canvas. You can see the canvas in the images they share.",
    "Speak briefly and plainly. Ask one useful question at a time. Say what you notice before you suggest anything.",
    "You change the canvas only through scaffold_canvas. For smaller edits, say which component should change and what it should say, and the team applies it.",
    "Use your tools instead of guessing. get_canvas_details reads components, arrows, and the current selection. get_workspace_context reads saved reviews, market research, buyer leads, engineering docs, specifications, and earlier discussions. lookup_web asks Context.dev for a fresh fact when it is not already saved. scaffold_canvas drafts the first product structure onto the canvas. navigate_workspace opens a tab or zooms to a component while you talk about it.",
    "CRITICAL: When the canvas has no components and the person describes a product they want (for example 'I want a booking app for barbers'), you MUST call scaffold_canvas with that brief before you talk about the design. Do not describe a fictional canvas — draw it with the tool. Prefer get_workspace_context before lookup_web. Never invent competitors, prices, people, or documentation.",
    "",
    `Project: ${projectName}`,
    `Goal: ${goal.trim() || "Not stated."}`,
    "",
    "Components on the canvas:",
    blocks,
  ].join("\n");
}

async function canvasDetails(editor: Editor, projectId: string) {
  const canvas = extractCanvas(editor);
  const selected = new Set<string>(editor.getSelectedShapeIds());
  const selection = canvas.blocks.filter((block) => selected.has(block.id));
  const specifications = await Promise.all(
    selection.slice(0, 5).map(async (block) => {
      const spec = await readSpecification(projectId, block.id);
      return { blockId: block.id, title: block.title, specification: describeSpecification(spec) };
    }),
  );
  return {
    components: canvas.blocks.map((block) => ({
      id: block.id,
      kind: BLOCK_META[block.kind].label,
      title: block.title,
      description: block.description,
    })),
    connections: canvas.connections.map((link) => ({
      from: link.fromTitle,
      to: link.toTitle,
      label: link.label,
    })),
    sketches: canvas.sketches,
    selection: selection.map((block) => ({ id: block.id, title: block.title })),
    specifications,
  };
}

async function scaffoldCanvas(editor: Editor, projectId: string, args: Record<string, unknown>) {
  const brief = readBrief(args);
  if (!brief) throw new Error("Pass a short brief for what to build.");
  const replace = readFlag(args.replace);
  const existing = extractCanvas(editor).blocks.length;
  if (existing > 0 && !replace) {
    return {
      ok: false as const,
      notice: "The canvas already has components. Ask them to confirm a start-over, then call again with replace true.",
      blockCount: existing,
    };
  }
  const response = await fetch("/api/ai/scaffold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, brief, replace }),
  });
  const data = await response.json();
  if (!response.ok || !data.plan) throw new Error(data.error ?? "Could not draft that canvas.");
  const plan = data.plan as ScaffoldPlan;
  const placed = applyScaffold(editor, plan, { replace: replace || existing === 0 });
  return { ok: true as const, summary: plan.summary, goal: plan.goal, ...placed };
}

function readBrief(args: Record<string, unknown>) {
  for (const key of ["brief", "description", "query", "prompt", "text"] as const) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  // Some Live builds send the whole argument object as a JSON string.
  if (typeof args === "string") {
    try {
      return readBrief(JSON.parse(args) as Record<string, unknown>);
    } catch {
      return String(args).trim();
    }
  }
  return "";
}

function readFlag(value: unknown) {
  return value === true || value === "true" || value === "True" || value === 1;
}

async function lookupWeb(projectId: string, args: Record<string, unknown>) {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) throw new Error("Pass a short question to look up.");
  const kind = isLookupKind(args.kind) ? args.kind : "answer";
  const response = await fetch("/api/voice/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, question, kind }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not run that live lookup.");
  return data.result as Record<string, unknown>;
}

async function workspaceContext(projectId: string, args: Record<string, unknown>) {
  const scope = typeof args.scope === "string" ? args.scope : "all";
  if (!(CONTEXT_SCOPES as readonly string[]).includes(scope)) throw new Error(`Unknown scope ${scope}.`);
  const response = await fetch("/api/voice/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, scope, blockId: typeof args.blockId === "string" ? args.blockId : undefined }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not read the workspace.");
  return data.context as Record<string, unknown>;
}

function navigate(editor: Editor, args: Record<string, unknown>, openTab: (tab: ArchitectTab) => void) {
  const done: string[] = [];
  if (isArchitectTab(args.tab)) {
    openTab(args.tab);
    done.push(`Opened the ${args.tab} tab.`);
  }
  if (typeof args.blockId === "string" && args.blockId) {
    const shape = editor.getShape(args.blockId as never);
    if (!shape || !isFormaBlock(shape)) throw new Error("That component is not on the canvas.");
    editor.select(shape.id);
    editor.zoomToSelection({ animation: { duration: 260 } });
    done.push(`Selected and zoomed to ${shape.props.title}.`);
  }
  if (done.length === 0) throw new Error("Pass a tab or a blockId.");
  return { ok: true, done };
}

// Sends the canvas as a picture when the voice session starts and again, debounced, whenever it changes.
function watchCanvas(editor: Editor, live: GeminiLiveClient) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let selectionKey = [...editor.getSelectedShapeIds()].join(",");

  const sendFrame = async () => {
    if (stopped || !live.isReady) return;
    const shapes = editor.getCurrentPageShapes();
    if (shapes.length === 0) return;
    try {
      const { url } = await editor.toImageDataUrl(shapes, { format: "jpeg", quality: 0.72, scale: 0.9, background: true });
      const base64 = url.split(",")[1];
      if (base64 && !stopped) live.sendFrame(base64);
    } catch {
      // A failed export skips one frame. The next change tries again.
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void sendFrame(), FRAME_DEBOUNCE_MS);
  };

  const unsubscribe = [
    editor.store.listen(schedule, { scope: "document" }),
    editor.store.listen(
      () => {
        const next = [...editor.getSelectedShapeIds()].join(",");
        if (next === selectionKey) return;
        selectionKey = next;
        schedule();
      },
      { scope: "session" },
    ),
  ];
  // The first frame waits for the session to be ready, then goes out right away.
  const first = setTimeout(() => void sendFrame(), 400);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    clearTimeout(first);
    unsubscribe.forEach((off) => off());
  };
}

async function readSpecification(projectId: string, blockId: string): Promise<Specification | null> {
  try {
    const response = await fetch(`/api/specifications?projectId=${projectId}&blockId=${encodeURIComponent(blockId)}`);
    const data = await response.json();
    return response.ok ? ((data.specification ?? null) as Specification | null) : null;
  } catch {
    return null;
  }
}

async function saveTurn(projectId: string, blockKey: string, role: "user" | "assistant", text: string, saved: () => void) {
  const message: ChatMessage = { id: createId(), role, content: text, createdAt: Date.now() };
  try {
    const response = await fetch("/api/conversations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, blockId: blockKey, messages: [message] }),
    });
    if (response.ok) saved();
  } catch {
    // The conversation is a record, not the product. A dropped save should not interrupt the call.
  }
}

function describeError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was blocked. Allow it in the browser to talk with the architect.";
  }
  return error instanceof Error ? error.message : "Could not start the voice session.";
}

function createId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
