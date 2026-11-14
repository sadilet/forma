"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import {
  ClipboardList,
  Component,
  FileText,
  LayoutGrid,
  Loader2,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Editor } from "tldraw";
import { Chat } from "@/components/workspace/architect/chat";
import { EngineeringTab } from "@/components/workspace/architect/engineering-tab";
import { LeadsTab } from "@/components/workspace/architect/leads-tab";
import { MarketTab } from "@/components/workspace/architect/market-tab";
import { ProposalList } from "@/components/workspace/architect/proposals";
import { FormaPresence } from "@/components/workspace/collab-bridge";
import { Button, Textarea } from "@/components/ui";
import type { CanvasUi } from "@/components/workspace/canvas-stage";
import { extractCanvas } from "@/lib/canvas/extract";
import { FORMA_BLOCK_TYPE } from "@/lib/canvas/kinds";
import { BLOCK_META } from "@/lib/canvas/kinds";
import {
  SPEC_FIELDS,
  emptySpecification,
  type CanvasProposal,
  type Finding,
  type Specification,
} from "@/lib/ai/schemas";
import {
  draftValue,
  editDraft,
  keepEdits,
  markSaved,
  receiveRemote,
  startDraft,
  takeIncoming,
  type Draft,
} from "@/lib/collab/draft";
import { versionOf, type SyncVersions } from "@/lib/collab/sync";
import type { ProjectRecord } from "@/lib/projects";
import { isArchitectTab, type ArchitectTab } from "@/lib/architect/tabs";
import { FORMA_NAVIGATE_EVENT } from "@/lib/voice/navigation";

type Mode = "architect" | "explorer";
type ExplorerTab = "discuss" | "spec";
type CanvasTab = ArchitectTab;

export function AiSidebar({
  open,
  mode,
  onMode,
  onClose,
  editor,
  ui,
  project,
  live,
  goal: goalDraft,
  setGoal,
  versions,
}: {
  open: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  onClose: () => void;
  editor: Editor | null;
  ui: CanvasUi;
  project: ProjectRecord;
  live: boolean;
  goal: Draft<string>;
  setGoal: Dispatch<SetStateAction<Draft<string>>>;
  versions: SyncVersions;
}) {
  const goalText = draftValue(goalDraft);
  const block = ui.block;
  const blockKey = mode === "explorer" && block ? block.id : "";
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("review");
  const [tab, setTab] = useState<ExplorerTab>("discuss");
  const [badgeClearance, setBadgeClearance] = useState(false);
  const architectTab = mode === "explorer" ? "component" : canvasTab;

  useEffect(() => {
    const update = () => setBadgeClearance(Boolean(document.getElementById("liveblocks-badge")));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);

  // The chat bar and Gemini Live open a tab when they flag a question. Follow them, and switch to the canvas view.
  useEffect(() => {
    const follow = (event: Event) => {
      const tab = (event as CustomEvent<string>).detail;
      if (isArchitectTab(tab)) setCanvasTab(tab);
    };
    window.addEventListener(FORMA_NAVIGATE_EVENT, follow);
    return () => window.removeEventListener(FORMA_NAVIGATE_EVENT, follow);
  }, []);

  if (!open) return null;

  return (
    <aside className={`relative z-30 flex h-full w-[min(32rem,100%)] shrink-0 flex-col border-l border-border bg-surface ${badgeClearance ? "pb-14" : ""}`}>
      {live ? <FormaPresence tab={architectTab} /> : null}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {mode === "explorer" && block ? block.props.title : "Architect"}
        </p>
        <button type="button" aria-label="Close architect" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 p-2">
        <ModeButton icon={LayoutGrid} active={mode === "architect"} onClick={() => onMode("architect")}>
          Canvas
        </ModeButton>
        <ModeButton icon={Component} active={mode === "explorer"} onClick={() => onMode("explorer")} disabled={!block}>
          Component
        </ModeButton>
      </div>

      {mode === "architect" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid grid-cols-4 gap-1 px-2">
            <ModeButton icon={ClipboardList} active={canvasTab === "review"} onClick={() => setCanvasTab("review")}>Review</ModeButton>
            <ModeButton icon={Store} active={canvasTab === "market"} onClick={() => setCanvasTab("market")}>Market</ModeButton>
            <ModeButton icon={Users} active={canvasTab === "leads"} onClick={() => setCanvasTab("leads")}>Leads</ModeButton>
            <ModeButton icon={ShieldCheck} active={canvasTab === "engineering"} onClick={() => setCanvasTab("engineering")}>Engineering</ModeButton>
          </div>
          {canvasTab === "review" ? (
            <ArchitectPane
              editor={editor}
              project={project}
              goalDraft={goalDraft}
              setGoal={setGoal}
              refreshToken={versionOf(versions, "analysis")}
              chatToken={versionOf(versions, "conversation", "")}
            />
          ) : null}
          {canvasTab === "market" ? (
            <MarketTab
              editor={editor}
              project={project}
              goal={goalText}
              refreshToken={versionOf(versions, "market")}
              chatToken={versionOf(versions, "conversation", "__market__")}
            />
          ) : null}
          {canvasTab === "leads" ? (
            <LeadsTab
              editor={editor}
              project={project}
              goal={goalText}
              refreshToken={versionOf(versions, "leads")}
              chatToken={versionOf(versions, "conversation", "__leads__")}
            />
          ) : null}
          {canvasTab === "engineering" ? (
            <EngineeringTab
              editor={editor}
              project={project}
              goal={goalText}
              refreshToken={versionOf(versions, "docs") + versionOf(versions, "standards")}
              chatToken={versionOf(versions, "conversation", "__engineering__")}
            />
          ) : null}
        </div>
      ) : (
        <ExplorerPane
          editor={editor}
          project={project}
          goal={goalText}
          block={block}
          tab={tab}
          setTab={setTab}
          blockKey={blockKey}
          chatToken={versionOf(versions, "conversation", blockKey)}
          specToken={block ? versionOf(versions, "specification", block.id) : 0}
        />
      )}
    </aside>
  );
}

function ArchitectPane({
  editor,
  project,
  goalDraft,
  setGoal,
  refreshToken,
  chatToken,
}: {
  editor: Editor | null;
  project: ProjectRecord;
  goalDraft: Draft<string>;
  setGoal: Dispatch<SetStateAction<Draft<string>>>;
  refreshToken: number;
  chatToken: number;
}) {
  const goal = draftValue(goalDraft);
  const [analysis, setAnalysis] = useState<Review | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ai/analyze?projectId=${project.id}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the review.");
        if (!cancelled) setAnalysis(data.analysis ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load the review.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshToken]);

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
      setAnalysis(data.analysis ?? null);
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
            id="forma-goal"
            value={goal}
            rows={2}
            onChange={(event) => {
              const value = event.target.value;
              setGoal((current) => editDraft(current, value));
            }}
            onBlur={() => {
              if (goalDraft.edits === null) setGoal(takeIncoming);
              else if (!goalDraft.incoming) void saveGoal(project.id, goalDraft, setGoal);
            }}
            placeholder="What is this product trying to do?"
          />
        </label>
        {goalDraft.incoming ? (
          <div className="mt-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5">
            <p>A teammate saved a different goal:</p>
            <p className="mt-1 line-clamp-3 text-foreground/80">{goalDraft.incoming.value || "(empty)"}</p>
            <div className="mt-1.5 flex gap-3">
              <button type="button" className="text-accent hover:underline" onClick={() => setGoal(takeIncoming)}>
                Use theirs
              </button>
              {goalDraft.edits !== null ? (
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    const kept = keepEdits(goalDraft);
                    setGoal(kept);
                    void saveGoal(project.id, kept, setGoal);
                  }}
                >
                  Keep mine
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
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
            <ProposalList proposals={analysis.canvasProposals ?? []} citations={[]} editor={editor} />
          </div>
        ) : null}
      </div>
      <Chat
        project={project}
        editor={editor}
        goal={goal}
        mode="review"
        block={null}
        blockKey=""
        refreshToken={chatToken}
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
  chatToken,
  specToken,
}: {
  editor: Editor | null;
  project: ProjectRecord;
  goal: string;
  block: CanvasUi["block"];
  tab: ExplorerTab;
  setTab: (tab: ExplorerTab) => void;
  blockKey: string;
  chatToken: number;
  specToken: number;
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
        <ModeButton icon={MessagesSquare} active={tab === "discuss"} onClick={() => setTab("discuss")}>
          Discuss
        </ModeButton>
        <ModeButton icon={FileText} active={tab === "spec"} onClick={() => setTab("spec")}>
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
          refreshToken={chatToken}
        />
      ) : (
        <SpecEditor projectId={project.id} editor={editor} block={block} goal={goal} refreshToken={specToken} />
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
        className="-mx-2 rounded-md bg-transparent px-2 py-1 text-sm font-medium outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/60"
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


function SpecEditor({
  projectId,
  editor,
  block,
  goal,
  refreshToken,
}: {
  projectId: string;
  editor: Editor;
  block: NonNullable<CanvasUi["block"]>;
  goal: string;
  refreshToken: number;
}) {
  const [sheet, setSheet] = useState<SpecSheet | null>(null);
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = sheet?.blockId === block.id ? sheet : null;
  const spec = current ? draftValue(current.draft) : emptySpecification();
  const proposal = current?.proposal ?? null;
  const incoming = current?.draft.incoming ?? null;

  function update(blockId: string, change: (sheet: SpecSheet) => SpecSheet) {
    setSheet((value) => (value?.blockId === blockId ? change(value) : value));
  }

  useEffect(() => {
    let cancelled = false;
    const blockId = block.id;
    readSpecification(projectId, blockId)
      .then((value) => {
        if (cancelled) return;
        const remote = { value: value.specification ?? emptySpecification(), version: value.updatedAt };
        setSheet((existing) =>
          existing?.blockId === blockId
            ? {
                ...existing,
                draft: receiveRemote(existing.draft, remote, existing.draft.edits !== null || existing.proposal !== null),
              }
            : { blockId, draft: startDraft(remote), proposal: null },
        );
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setSheet((existing) =>
          existing?.blockId === blockId
            ? existing
            : { blockId, draft: startDraft({ value: emptySpecification(), version: null }), proposal: null },
        );
        setError(caught instanceof Error ? caught.message : "Could not load the specification.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, block.id, refreshToken]);

  async function save() {
    if (!current) return;
    const { blockId, draft } = current;
    const sentProposal = current.proposal;
    const sentEdits = draft.edits;
    const next = normalize(sentProposal ?? draftValue(draft));
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/specifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, blockId, specification: next, expectedUpdatedAt: draft.saved.version }),
      });
      const data = await response.json();
      if (response.status === 409) {
        const remote = { value: data.specification ?? emptySpecification(), version: data.updatedAt ?? null };
        update(blockId, (value) => ({ ...value, draft: receiveRemote(value.draft, remote, true) }));
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Could not save.");
      update(blockId, (value) => ({
        blockId,
        draft: markSaved(value.draft, { value: next, version: data.updatedAt ?? null }, sentEdits),
        proposal: value.proposal === sentProposal ? null : value.proposal,
      }));
      toast.success("Specification saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function propose() {
    const blockId = block.id;
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
      update(blockId, (value) => ({ ...value, proposal: data as Specification }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not draft a specification.");
    } finally {
      setProposing(false);
    }
  }

  if (!current) return <p className="px-3 py-4 text-xs text-muted-foreground">Loading specification…</p>;

  const shown = proposal ?? spec;
  return (
    <div className="forma-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {incoming ? (
        <div className="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5">
          A teammate saved this specification after you started editing. Your draft is unchanged.
          <div className="mt-1.5 flex gap-3">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => {
                update(current.blockId, (value) => ({ ...value, draft: takeIncoming(value.draft), proposal: null }));
                setError(null);
              }}
            >
              Load theirs
            </button>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => update(current.blockId, (value) => ({ ...value, draft: keepEdits(value.draft) }))}
            >
              Keep my draft
            </button>
          </div>
        </div>
      ) : null}
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
                update(current.blockId, (sheet) =>
                  sheet.proposal ? { ...sheet, proposal: next } : { ...sheet, draft: editDraft(sheet.draft, next) },
                );
              }}
            />
          </label>
        ))}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      <div className="mt-3 grid gap-2">
        {proposal ? (
          <>
            <Button variant="accent" disabled={saving || incoming !== null} onClick={() => void save()}>
              {saving ? "Saving…" : "Apply proposal"}
            </Button>
            <Button variant="ghost" onClick={() => update(current.blockId, (value) => ({ ...value, proposal: null }))}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={saving || incoming !== null} onClick={() => void save()}>
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
      ? "text-danger"
      : finding.severity === "warning"
        ? "text-warning"
        : "text-info";
  return (
    <article className="rounded-xl border border-border bg-surface-subtle p-3">
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
  icon: Icon,
  active,
  disabled,
  onClick,
  children,
}: {
  icon: LucideIcon;
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
      className={`flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 ${
        active ? "bg-accent-soft text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger">{message}</p>;
}

async function saveGoal(projectId: string, draft: Draft<string>, setGoal: Dispatch<SetStateAction<Draft<string>>>) {
  const sent = draft.edits;
  if (sent === null) return;
  const { updateProject } = await import("@/app/actions");
  const result = await updateProject({ id: projectId, goal: sent, expectedGoal: draft.saved.value });
  if ("error" in result) {
    toast.error(result.error);
    return;
  }
  const saved = { value: result.goal, version: null };
  if ("conflict" in result) setGoal((current) => receiveRemote(current, saved, true));
  else setGoal((current) => markSaved(current, saved, sent));
}

async function readSpecification(projectId: string, blockId: string) {
  const response = await fetch(`/api/specifications?projectId=${projectId}&blockId=${encodeURIComponent(blockId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load the specification.");
  return {
    specification: (data.specification ?? null) as Specification | null,
    updatedAt: (data.updatedAt ?? null) as number | null,
  };
}

type Review = {
  summary: string;
  findings: Finding[];
  canvasProposals: CanvasProposal[];
};

type SpecSheet = {
  blockId: string;
  draft: Draft<Specification>;
  proposal: Specification | null;
};

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
