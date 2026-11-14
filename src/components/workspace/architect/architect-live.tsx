"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Editor } from "tldraw";
import type { CanvasUi } from "@/components/workspace/canvas-stage";
import type { Decision, DecisionSource } from "@/lib/ai/decision";
import type { CanvasProposal, ChatMessage, Specification } from "@/lib/ai/schemas";
import { TAB_BLOCK_KEY, TAB_CHAT_MODE, TAB_META, type ArchitectTab } from "@/lib/architect/tabs";
import { hasArtifact, pipelineLabel, runPipeline } from "@/lib/architect/pipelines";
import { applyScaffold } from "@/lib/canvas/apply-scaffold";
import { extractCanvas } from "@/lib/canvas/extract";
import type { ScaffoldPlan } from "@/lib/canvas/scaffold-schema";
import type { ResourceKind } from "@/lib/collab/events";
import type { ProjectRecord } from "@/lib/projects";
import type { Citation } from "@/lib/research/citations";

// The chat bar at the bottom of the canvas owns every question. It asks the Decisions API which pillar the question
// belongs to, opens that tab, runs whatever that tab is missing, then streams the answer into that tab's thread.
// Tabs read what is happening here and show it. They do not run questions themselves.

export type LiveThread = {
  // Messages from this browser's bar. The saved thread is the source of truth once it reloads.
  messages: ChatMessage[];
  proposals: Record<string, { proposals: CanvasProposal[]; citations: Citation[] }>;
  // What the architect is doing right now, for example "Researching the market". Null when idle.
  status: string | null;
  // A line worth showing in the feed, for example that live lookup is off.
  notice: string | null;
  error: string | null;
};

export type Phase =
  | { kind: "idle" }
  | { kind: "routing" }
  | { kind: "working"; tab: ArchitectTab; step: string }
  | { kind: "answering"; tab: ArchitectTab }
  | { kind: "done"; tab: ArchitectTab };

export type FlaggedAs = {
  tab: ArchitectTab;
  label: string;
  confidence: number | null;
  source: DecisionSource | "chosen";
};

type AskOptions = {
  // Skip routing when the person picked the pillar themselves, for example from a suggestion inside a tab.
  tab?: ArchitectTab;
  // Wipe the page and draft again. Used when voice asks to start over.
  replace?: boolean;
};

type ArchitectLiveValue = {
  threads: Readonly<Record<string, LiveThread>>;
  phase: Phase;
  flagged: FlaggedAs | null;
  busy: boolean;
  ready: boolean;
  ask: (text: string, options?: AskOptions) => Promise<void>;
};

const EMPTY_THREAD: LiveThread = { messages: [], proposals: {}, status: null, notice: null, error: null };

const ArchitectLiveContext = createContext<ArchitectLiveValue | null>(null);

export function useArchitectLive(): ArchitectLiveValue {
  const value = useContext(ArchitectLiveContext);
  if (!value) {
    return {
      threads: {},
      phase: { kind: "idle" },
      flagged: null,
      busy: false,
      ready: false,
      ask: async () => undefined,
    };
  }
  return value;
}

export function threadFor(threads: Readonly<Record<string, LiveThread>>, blockKey: string) {
  return threads[blockKey] ?? EMPTY_THREAD;
}

export function ArchitectLiveProvider({
  editor,
  project,
  goal,
  block,
  onOpenTab,
  onChanged,
  onGoalSuggested,
  children,
}: {
  editor: Editor | null;
  project: ProjectRecord;
  goal: string;
  block: CanvasUi["block"];
  onOpenTab: (tab: ArchitectTab) => void;
  // Our own saves never come back as room events, so the workspace bumps its versions here.
  onChanged: (resource: ResourceKind, blockId?: string) => void;
  // Scaffolding can fill an empty workspace goal from the brief.
  onGoalSuggested?: (goal: string) => void;
  children: ReactNode;
}) {
  const [threads, setThreads] = useState<Record<string, LiveThread>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [flagged, setFlagged] = useState<FlaggedAs | null>(null);
  const busyRef = useRef(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback((blockKey: string, change: (thread: LiveThread) => LiveThread) => {
    setThreads((current) => ({ ...current, [blockKey]: change(current[blockKey] ?? EMPTY_THREAD) }));
  }, []);

  const ask = useCallback(
    async (text: string, options?: AskOptions) => {
      const question = text.trim();
      if (!question || !editor || busyRef.current) return;
      busyRef.current = true;
      if (doneTimer.current) clearTimeout(doneTimer.current);
      setPhase({ kind: "routing" });
      setFlagged(null);

      let tab: ArchitectTab | null = null;
      let blockKey = "";
      try {
        const canvas = extractCanvas(editor);

        // 1. Which pillar is this question about? The Decisions API reads it. A tab the person chose wins.
        let decision: Decision;
        let source: FlaggedAs["source"] = "chosen";
        if (options?.tab) {
          decision = {
            tab: options.tab,
            shouldRunPipeline: false,
            shouldScaffold: false,
            label: `Flagged as ${TAB_META[options.tab].label}`,
            confidence: 1,
          };
        } else {
          const routed = await classify({
            projectId: project.id,
            question,
            projectGoal: goal,
            blockTitles: canvas.blocks.map((item) => item.title),
            canvasEmpty: canvas.blocks.length === 0,
          });
          decision = routed.decision;
          source = routed.source;
        }
        tab = decision.tab;
        blockKey = TAB_BLOCK_KEY[tab];
        const confident = source === "gemini-decision" ? decision.confidence : null;
        const replace = Boolean(options?.replace);
        const canScaffold = decision.shouldScaffold && (canvas.blocks.length === 0 || replace);
        setFlagged({
          tab,
          label: canScaffold ? "Drafting the canvas" : decision.label,
          confidence: confident,
          source,
        });

        // 2. Show the question in that tab straight away, so routing feels instant.
        const userMessage = message("user", question);
        const assistantId = createId();
        onOpenTab(tab);
        patch(blockKey, (thread) => ({
          ...thread,
          messages: [userMessage, { id: assistantId, role: "assistant", content: "", createdAt: Date.now() }],
          proposals: {},
          status: null,
          notice: null,
          error: null,
        }));

        // 3a. Empty canvas (or an explicit start-over): draft the first structure before answering.
        if (canScaffold) {
          setPhase({ kind: "working", tab, step: "Drafting the canvas" });
          patch(blockKey, (thread) => ({ ...thread, status: "Drafting the canvas…" }));
          const plan = await requestScaffold(project.id, question, replace);
          applyScaffold(editor, plan, { replace });
          if (plan.goal.trim()) onGoalSuggested?.(plan.goal);
          const answer = [
            plan.summary.trim(),
            "",
            `I placed ${plan.blocks.length} components on the canvas. You can move them, rename them, or ask what is still undecided.`,
          ].join("\n");
          patch(blockKey, (thread) => ({
            ...thread,
            status: null,
            messages: thread.messages.map((item) => (item.id === assistantId ? { ...item, content: answer } : item)),
          }));
          const prior = [...(await loadHistory(project.id, blockKey)), userMessage];
          const saved: ChatMessage[] = [
            ...prior,
            { id: assistantId, role: "assistant", content: answer, createdAt: Date.now() },
          ];
          await fetch("/api/conversations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id, blockId: blockKey, messages: saved.slice(-40) }),
          }).catch(() => undefined);
          onChanged("conversation", blockKey);
          setPhase({ kind: "done", tab });
          doneTimer.current = setTimeout(() => setPhase({ kind: "idle" }), 8000);
          return;
        }

        if (decision.shouldScaffold && canvas.blocks.length > 0) {
          patch(blockKey, (thread) => ({
            ...thread,
            notice: "The canvas already has components. Clear it, or ask me to start over, if you want a new draft.",
          }));
        }

        // 3b. Does this tab have what it needs? If not, or if the question asks for a fresh run, run it.
        const [history, artifactReady] = await Promise.all([
          loadHistory(project.id, blockKey),
          hasArtifact(tab, project.id),
        ]);
        if (!artifactReady || decision.shouldRunPipeline) {
          const step = pipelineLabel(tab);
          setPhase({ kind: "working", tab, step });
          patch(blockKey, (thread) => ({ ...thread, status: `${step}…` }));
          const result = await runPipeline(tab, { projectId: project.id, goal, canvas });
          for (const resource of result.changed) onChanged(resource);
          patch(blockKey, (thread) => ({ ...thread, status: null, notice: result.notice ?? thread.notice }));
        }

        // 4. Answer from the freshest context, streaming into the tab's thread.
        setPhase({ kind: "answering", tab });
        const prior = [...history, userMessage];
        const answer = await streamAnswer({
          project,
          goal,
          editor,
          block,
          mode: tab,
          prior,
          onText: (content) =>
            patch(blockKey, (thread) => ({
              ...thread,
              messages: thread.messages.map((item) => (item.id === assistantId ? { ...item, content } : item)),
            })),
        });

        // 5. Save the thread, then ask for canvas changes the answer implies.
        const saved: ChatMessage[] = [
          ...prior,
          { id: assistantId, role: "assistant", content: answer, createdAt: Date.now() },
        ];
        await fetch("/api/conversations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, blockId: blockKey, messages: saved.slice(-40) }),
        }).catch(() => undefined);
        onChanged("conversation", blockKey);

        if (answer.trim()) {
          const proposed = await fetchProposals({ project, goal, editor, block, mode: tab, answer });
          if (proposed)
            patch(blockKey, (thread) => ({ ...thread, proposals: { ...thread.proposals, [assistantId]: proposed } }));
        }
        setPhase({ kind: "done", tab });
        doneTimer.current = setTimeout(() => setPhase({ kind: "idle" }), 8000);
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : "The architect could not respond.";
        if (blockKey) {
          patch(blockKey, (thread) => ({
            ...thread,
            status: null,
            error: reason,
            messages: thread.messages.filter((item) => item.role !== "assistant" || item.content.trim().length > 0),
          }));
        } else {
          toast.error(reason);
        }
        setPhase({ kind: "idle" });
      } finally {
        busyRef.current = false;
      }
    },
    [editor, project, goal, block, onOpenTab, onChanged, onGoalSuggested, patch],
  );

  const value = useMemo<ArchitectLiveValue>(
    () => ({
      threads,
      phase,
      flagged,
      busy: phase.kind === "routing" || phase.kind === "working" || phase.kind === "answering",
      ready: Boolean(editor),
      ask,
    }),
    [threads, phase, flagged, editor, ask],
  );

  return <ArchitectLiveContext.Provider value={value}>{children}</ArchitectLiveContext.Provider>;
}

async function requestScaffold(projectId: string, brief: string, replace: boolean) {
  const response = await fetch("/api/ai/scaffold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, brief, replace }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.plan) throw new Error(data.error ?? "Could not draft that canvas.");
  return data.plan as ScaffoldPlan;
}

async function classify(input: {
  projectId: string;
  question: string;
  projectGoal: string;
  blockTitles: string[];
  canvasEmpty?: boolean;
}) {
  const response = await fetch("/api/ai/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.decision) throw new Error(data.error ?? "Could not work out where that question belongs.");
  return data as { decision: Decision; source: DecisionSource };
}

async function loadHistory(projectId: string, blockKey: string): Promise<ChatMessage[]> {
  try {
    const response = await fetch(`/api/conversations?projectId=${projectId}&blockId=${encodeURIComponent(blockKey)}`);
    const data = await response.json();
    // The chat route accepts a bounded number of turns. Keep the most recent ones.
    return response.ok && Array.isArray(data.messages) ? (data.messages as ChatMessage[]).slice(-18) : [];
  } catch {
    return [];
  }
}

function blockPayload(block: CanvasUi["block"]) {
  return block
    ? { id: block.id, kind: block.props.kind, title: block.props.title, description: block.props.description }
    : null;
}

async function loadSpecification(projectId: string, block: CanvasUi["block"]) {
  if (!block) return null;
  try {
    const response = await fetch(`/api/specifications?projectId=${projectId}&blockId=${encodeURIComponent(block.id)}`);
    const data = await response.json();
    return response.ok ? ((data.specification ?? null) as Specification | null) : null;
  } catch {
    return null;
  }
}

async function streamAnswer(input: {
  project: ProjectRecord;
  goal: string;
  editor: Editor;
  block: CanvasUi["block"];
  mode: ArchitectTab;
  prior: ChatMessage[];
  onText: (content: string) => void;
}) {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.project.id,
      mode: TAB_CHAT_MODE[input.mode],
      projectGoal: input.goal,
      canvas: extractCanvas(input.editor),
      block: blockPayload(input.block),
      specification: await loadSpecification(input.project.id, input.block),
      messages: input.prior.map((item) => ({ role: item.role, content: item.content })),
    }),
  });
  if (!response.ok || (response.headers.get("content-type") ?? "").includes("application/json")) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "The architect could not respond.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The architect returned an empty response.");
  const decoder = new TextDecoder();
  let answer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    answer += decoder.decode(chunk.value, { stream: true });
    input.onText(answer);
  }
  return answer;
}

async function fetchProposals(input: {
  project: ProjectRecord;
  goal: string;
  editor: Editor;
  block: CanvasUi["block"];
  mode: ArchitectTab;
  answer: string;
}) {
  try {
    const response = await fetch("/api/ai/canvas-proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: input.project.id,
        mode: TAB_CHAT_MODE[input.mode],
        projectGoal: input.goal,
        canvas: extractCanvas(input.editor),
        message: input.answer,
        block: blockPayload(input.block),
      }),
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.proposals) || data.proposals.length === 0) return null;
    return { proposals: data.proposals as CanvasProposal[], citations: (data.citations ?? []) as Citation[] };
  } catch {
    return null;
  }
}

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: createId(), role, content, createdAt: Date.now() };
}

function createId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
