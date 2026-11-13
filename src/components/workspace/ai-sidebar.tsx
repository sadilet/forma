"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, X } from "lucide-react";
import type { Editor } from "tldraw";
import { Button, Textarea } from "@/components/ui";
import type { CanvasUi } from "@/components/workspace/canvas-stage";
import { extractCanvas } from "@/lib/canvas/extract";
import { FORMA_BLOCK_TYPE } from "@/lib/canvas/kinds";
import { BLOCK_META, type BlockKind } from "@/lib/canvas/kinds";
import {
  SPEC_FIELDS,
  emptySpecification,
  type Analysis,
  type ChatMessage,
  type Finding,
  type Specification,
} from "@/lib/ai/schemas";
import { suggestionsFor } from "@/lib/ai/prompt";
import type { ProjectRecord } from "@/lib/projects";

type Mode = "architect" | "explorer";
type ExplorerTab = "discuss" | "spec";

export function AiSidebar({
  open,
  mode,
  onMode,
  onClose,
  editor,
  ui,
  project,
}: {
  open: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  onClose: () => void;
  editor: Editor | null;
  ui: CanvasUi;
  project: ProjectRecord;
}) {
  const block = ui.block;
  const blockKey = mode === "explorer" && block ? block.id : "";
  const [goal, setGoal] = useState(project.goal);
  const [tab, setTab] = useState<ExplorerTab>("discuss");

  if (!open) return null;

  return (
    <aside className="flex h-full w-[min(400px,100%)] shrink-0 flex-col border-l border-border bg-[#121318]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Sparkles className="h-4 w-4 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Architect</p>
          <p className="truncate text-xs text-muted-foreground">
            {mode === "explorer" && block
              ? `${block.props.title} · ${BLOCK_META[block.props.kind].label}`
              : "Whole canvas"}
          </p>
        </div>
        <button type="button" aria-label="Close architect" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-white/6 hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 p-2">
        <ModeButton active={mode === "architect"} onClick={() => onMode("architect")}>
          Canvas
        </ModeButton>
        <ModeButton active={mode === "explorer"} onClick={() => onMode("explorer")} disabled={!block}>
          Component
        </ModeButton>
      </div>

      {mode === "architect" ? (
        <ArchitectPane editor={editor} project={project} goal={goal} setGoal={setGoal} blockKey={blockKey} />
      ) : (
        <ExplorerPane
          editor={editor}
          project={project}
          goal={goal}
          block={block}
          tab={tab}
          setTab={setTab}
          blockKey={blockKey}
        />
      )}
    </aside>
  );
}

function ArchitectPane({
  editor,
  project,
  goal,
  setGoal,
  blockKey,
}: {
  editor: Editor | null;
  project: ProjectRecord;
  goal: string;
  setGoal: (goal: string) => void;
  blockKey: string;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    if (!editor) return;
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          projectGoal: goal,
          canvas: extractCanvas(editor),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Analysis failed.");
      setAnalysis(data as Analysis);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <div className="forma-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          Project goal
          <Textarea
            value={goal}
            rows={3}
            onChange={(event) => setGoal(event.target.value)}
            onBlur={() => void updateGoal(project.id, goal)}
            placeholder="What is this product trying to do?"
          />
        </label>
        <Button variant="accent" className="mt-3 w-full" disabled={!editor || analyzing} onClick={() => void analyze()}>
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {analyzing ? "Reading the canvas" : "Analyze canvas"}
        </Button>
        {error ? <ErrorNote message={error} /> : null}
        {analysis ? (
          <div className="mt-4 grid gap-3">
            <p className="text-sm leading-6 text-foreground/90">{analysis.summary}</p>
            {analysis.findings.map((finding, index) => (
              <FindingCard
                key={`${finding.title}-${index}`}
                finding={finding}
                onFocus={() => focusBlock(editor, finding.relatedBlockId)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Analysis reads every component and connection, then returns questions the team should settle. It will not edit the canvas.
          </p>
        )}
      </div>
      <Chat
        project={project}
        editor={editor}
        goal={goal}
        mode="global"
        block={null}
        blockKey={blockKey}
      />
    </>
  );
}

function ExplorerPane({
  editor,
  project,
  goal,
  block,
  tab,
  setTab,
  blockKey,
}: {
  editor: Editor | null;
  project: ProjectRecord;
  goal: string;
  block: CanvasUi["block"];
  tab: ExplorerTab;
  setTab: (tab: ExplorerTab) => void;
  blockKey: string;
}) {
  if (!block || !editor) {
    return (
      <p className="px-4 py-6 text-sm leading-6 text-muted-foreground">
        Select a screen, service, database, entity, decision, or note to explore it.
      </p>
    );
  }

  return (
    <>
      <BlockFields editor={editor} block={block} />
      <div className="grid grid-cols-2 gap-1 px-2">
        <ModeButton active={tab === "discuss"} onClick={() => setTab("discuss")}>
          Discuss
        </ModeButton>
        <ModeButton active={tab === "spec"} onClick={() => setTab("spec")}>
          Specification
        </ModeButton>
      </div>
      {tab === "discuss" ? (
        <Chat
          project={project}
          editor={editor}
          goal={goal}
          mode="local"
          block={block}
          blockKey={blockKey}
        />
      ) : (
        <SpecEditor projectId={project.id} editor={editor} block={block} goal={goal} />
      )}
    </>
  );
}

function BlockFields({ editor, block }: { editor: Editor; block: NonNullable<CanvasUi["block"]> }) {
  const [title, setTitle] = useState(block.props.title);
  const [description, setDescription] = useState(block.props.description);
  const [synced, setSynced] = useState({
    id: block.id,
    title: block.props.title,
    description: block.props.description,
  });
  if (
    synced.id !== block.id ||
    synced.title !== block.props.title ||
    synced.description !== block.props.description
  ) {
    setSynced({ id: block.id, title: block.props.title, description: block.props.description });
    setTitle(block.props.title);
    setDescription(block.props.description);
  }

  function commit(next: { title?: string; description?: string }) {
    const current = editor.getShape(block.id);
    if (!current || current.type !== FORMA_BLOCK_TYPE) return;
    editor.updateShape({
      id: block.id,
      type: FORMA_BLOCK_TYPE,
      props: next,
    });
  }

  const meta = BLOCK_META[block.props.kind];
  return (
    <div className="grid gap-2 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: meta.color }}>
        {meta.label}
      </p>
      <input
        value={title}
        aria-label="Component title"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => commit({ title })}
        className="bg-transparent text-sm font-medium outline-none"
      />
      <Textarea
        value={description}
        rows={3}
        aria-label="Component description"
        placeholder="What does this component do?"
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => commit({ description })}
      />
    </div>
  );
}

function Chat({
  project,
  editor,
  goal,
  mode,
  block,
  blockKey,
}: {
  project: ProjectRecord;
  editor: Editor | null;
  goal: string;
  mode: "global" | "local";
  block: CanvasUi["block"];
  blockKey: string;
}) {
  const [history, setHistory] = useState<{ key: string; messages: ChatMessage[] }>({ key: "", messages: [] });
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind: BlockKind | "global" = block ? block.props.kind : "global";
  const historyKey = `${project.id}:${blockKey}`;
  const loadingHistory = history.key !== historyKey;
  const messages = loadingHistory ? [] : history.messages;

  function setMessages(next: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) {
    setHistory((current) => {
      const base = current.key === historyKey ? current.messages : [];
      const messages = typeof next === "function" ? next(base) : next;
      return { key: historyKey, messages };
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/conversations?projectId=${project.id}&blockId=${encodeURIComponent(blockKey)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the conversation.");
        if (!cancelled) setHistory({ key: historyKey, messages: data.messages ?? [] });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setHistory({ key: historyKey, messages: [] });
        setError(caught instanceof Error ? caught.message : "Could not load the conversation.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, blockKey, historyKey]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || !editor || streaming) return;
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content,
      createdAt: timestamp(),
    };
    const history = [...messages, userMessage];
    const assistantId = createId();
    setMessages(history);
    setDraft("");
    setStreaming(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          mode,
          projectGoal: goal,
          canvas: extractCanvas(editor),
          block: block
            ? {
                id: block.id,
                kind: block.props.kind,
                title: block.props.title,
                description: block.props.description,
              }
            : null,
          specification: mode === "local" ? await loadSpecification(project.id, blockKey) : null,
          messages: history.map((message) => ({ role: message.role, content: message.content })),
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
      setMessages((current) => [
        ...current,
        { id: assistantId, role: "assistant", content: "", createdAt: timestamp() },
      ]);
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        answer += decoder.decode(chunk.value, { stream: true });
        const next = answer;
        setMessages((current) =>
          current.map((message) => (message.id === assistantId ? { ...message, content: next } : message)),
        );
      }
      const saved = [
        ...history,
        { id: assistantId, role: "assistant" as const, content: answer, createdAt: timestamp() },
      ];
      setMessages(saved);
      await fetch("/api/conversations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, blockId: blockKey, messages: saved }),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The architect could not respond.");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="forma-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {loadingHistory ? <p className="text-xs text-muted-foreground">Loading conversation…</p> : null}
        {messages.length === 0 && !loadingHistory ? (
          <div className="grid gap-2">
            <p className="text-sm leading-6 text-muted-foreground">
              {mode === "local" && block
                ? `Let's explore how ${block.props.title} should work.`
                : "Ask about the system as a whole."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestionsFor(kind).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={streaming || !editor}
                  onClick={() => void send(suggestion)}
                  className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-muted-foreground hover:border-accent/40 hover:text-foreground disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-6 rounded-xl bg-white/6 px-3 py-2 text-sm leading-6"
                : "border-l border-accent/50 pl-3 text-sm leading-6 text-foreground/90"
            }
          >
            {message.content ? <MessageBody content={message.content} /> : streaming ? "…" : ""}
          </div>
        ))}
        {error ? <ErrorNote message={error} /> : null}
      </div>
      <form
        className="grid gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <Textarea
          value={draft}
          rows={2}
          placeholder={mode === "local" ? "Ask about this component" : "Ask about the canvas"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <Button type="submit" variant="accent" disabled={streaming || !draft.trim() || !editor}>
          {streaming ? "Thinking" : "Send"}
        </Button>
      </form>
    </div>
  );
}

function SpecEditor({
  projectId,
  editor,
  block,
  goal,
}: {
  projectId: string;
  editor: Editor;
  block: NonNullable<CanvasUi["block"]>;
  goal: string;
}) {
  const [loaded, setLoaded] = useState<{ blockId: string; spec: Specification } | null>(null);
  const [proposal, setProposal] = useState<Specification | null>(null);
  const [proposalFor, setProposalFor] = useState(block.id);
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = !loaded || loaded.blockId !== block.id;
  const spec = loaded?.blockId === block.id ? loaded.spec : emptySpecification();

  if (proposalFor !== block.id) {
    setProposalFor(block.id);
    setProposal(null);
  }

  function setSpec(next: Specification) {
    setLoaded({ blockId: block.id, spec: next });
  }

  useEffect(() => {
    let cancelled = false;
    loadSpecification(projectId, block.id)
      .then((value) => {
        if (!cancelled) setLoaded({ blockId: block.id, spec: value ?? emptySpecification() });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoaded({ blockId: block.id, spec: emptySpecification() });
        setError(caught instanceof Error ? caught.message : "Could not load the specification.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, block.id]);

  async function save(next: Specification) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/specifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, blockId: block.id, specification: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save.");
      setSpec(next);
      setProposal(null);
      toast.success("Specification saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function propose() {
    setProposing(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/specify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectGoal: goal,
          canvas: extractCanvas(editor),
          block: {
            id: block.id,
            kind: block.props.kind,
            title: block.props.title,
            description: block.props.description,
          },
          specification: spec,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not draft a specification.");
      setProposal(data as Specification);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not draft a specification.");
    } finally {
      setProposing(false);
    }
  }

  if (loading) return <p className="px-3 py-4 text-xs text-muted-foreground">Loading specification…</p>;

  const shown = proposal ?? spec;
  return (
    <div className="forma-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {proposal ? (
        <div className="mb-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs leading-5 text-accent-foreground">
          This is a proposal. Nothing is saved until you apply it.
        </div>
      ) : null}
      <div className="grid gap-3">
        {SPEC_FIELDS.map((field) => (
          <label key={field.key} className="grid gap-1.5 text-xs text-muted-foreground">
            {field.label}
            <Textarea
              rows={field.list ? 4 : 3}
              value={field.list ? (shown[field.key] as string[]).join("\n") : (shown[field.key] as string)}
              onChange={(event) => {
                const value = field.list
                  ? event.target.value.split("\n")
                  : event.target.value;
                const next = { ...shown, [field.key]: value };
                if (proposal) setProposal(next);
                else setSpec(next);
              }}
            />
          </label>
        ))}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      <div className="mt-3 grid gap-2">
        {proposal ? (
          <>
            <Button variant="accent" disabled={saving} onClick={() => void save(normalize(proposal))}>
              {saving ? "Saving…" : "Apply proposal"}
            </Button>
            <Button variant="ghost" onClick={() => setProposal(null)}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={saving} onClick={() => void save(normalize(spec))}>
              {saving ? "Saving…" : "Save specification"}
            </Button>
            <Button variant="quiet" disabled={proposing} onClick={() => void propose()}>
              {proposing ? "Drafting…" : "Propose an update"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function FindingCard({ finding, onFocus }: { finding: Finding; onFocus: () => void }) {
  const tone =
    finding.severity === "critical"
      ? "text-[#f0a3a8]"
      : finding.severity === "warning"
        ? "text-[#f0a05a]"
        : "text-[#6ea8fe]";
  return (
    <article className="rounded-xl border border-border bg-white/[0.02] p-3">
      <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
        {finding.severity} · {finding.category.replaceAll("-", " ")}
      </p>
      <h3 className="mt-1 text-sm font-medium">{finding.title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{finding.description}</p>
      <p className="mt-2 text-sm leading-6">“{finding.question}”</p>
      {finding.relatedBlockId ? (
        <button type="button" onClick={onFocus} className="mt-2 text-xs text-accent hover:underline">
          Show {finding.relatedBlockTitle || "component"}
        </button>
      ) : null}
    </article>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 rounded-lg text-xs font-medium disabled:opacity-40 ${
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <p className="mt-3 rounded-lg border border-[#f0a3a8]/30 bg-[#f0a3a8]/10 px-3 py-2 text-sm leading-5 text-[#f0a3a8]">{message}</p>;
}

function MessageBody({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim().length > 0);
        const list = lines.length > 0 && lines.every((line) => /^(\s*[-*]|\s*\d+[.)])\s+/.test(line));
        if (list) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-4">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inlineText(line.replace(/^(\s*[-*]|\s*\d+[.)])\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inlineText(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inlineText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-medium">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function timestamp() {
  return Date.now();
}

function createId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function updateGoal(projectId: string, goal: string) {
  const { updateProject } = await import("@/app/actions");
  const result = await updateProject({ id: projectId, goal });
  if (result?.error) toast.error(result.error);
}

async function loadSpecification(projectId: string, blockId: string) {
  if (!blockId) return null;
  const response = await fetch(
    `/api/specifications?projectId=${projectId}&blockId=${encodeURIComponent(blockId)}`,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load the specification.");
  return (data.specification ?? null) as Specification | null;
}

function focusBlock(editor: Editor | null, id: string | null) {
  if (!editor || !id) return;
  const shape = editor.getShape(id as never);
  if (!shape) return;
  editor.select(shape.id);
  editor.zoomToSelection({ animation: { duration: 220 } });
}

function normalize(spec: Specification): Specification {
  const lists = [
    "functionalRequirements",
    "businessRules",
    "dependencies",
    "edgeCases",
    "openQuestions",
    "architecturalDecisions",
  ] as const;
  const next = { ...spec };
  for (const key of lists) {
    next[key] = next[key].map((item) => item.trim()).filter(Boolean);
  }
  return next;
}
