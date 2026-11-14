"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { Editor } from "tldraw";
import { threadFor, useArchitectLive } from "@/components/workspace/architect/architect-live";
import { ProposalList } from "@/components/workspace/architect/proposals";
import { Button, Textarea } from "@/components/ui";
import type { CanvasUi } from "@/components/workspace/canvas-stage";
import { extractCanvas } from "@/lib/canvas/extract";
import type { BlockKind } from "@/lib/canvas/kinds";
import type { CanvasProposal, ChatMessage, Specification } from "@/lib/ai/schemas";
import { suggestionsFor } from "@/lib/ai/prompt";
import { tabForBlockKey, type ChatMode } from "@/lib/architect/tabs";
import type { Citation } from "@/lib/research/citations";
import type { ProjectRecord } from "@/lib/projects";

// A stable empty list, so memoised values that depend on the loaded thread do not recompute while it loads.
const NO_MESSAGES: ChatMessage[] = [];

export function Chat({
  project,
  editor,
  goal,
  mode,
  block,
  blockKey,
  refreshToken,
}: {
  project: ProjectRecord;
  editor: Editor | null;
  goal: string;
  mode: ChatMode;
  block: CanvasUi["block"];
  blockKey: string;
  refreshToken: number;
}) {
  const [history, setHistory] = useState<{
    key: string;
    messages: ChatMessage[];
  }>({ key: "", messages: [] });
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, { proposals: CanvasProposal[]; citations: Citation[] }>>(
    {},
  );
  const streamingRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const kind: BlockKind | "global" = block ? block.props.kind : "global";
  const historyKey = `${project.id}:${blockKey}`;
  const loadingHistory = history.key !== historyKey;
  const messages = loadingHistory ? NO_MESSAGES : history.messages;

  // Canvas tabs share the architect's ask path, pinned to the tab the person is on. A component keeps its own send.
  const architect = useArchitectLive();
  const overlay = threadFor(architect.threads, blockKey);
  const routedTab = mode === "local" ? null : tabForBlockKey(blockKey);
  const shown = useMemo(() => {
    if (!routedTab) return messages;
    const known = new Set(messages.map((message) => message.id));
    return [...messages, ...overlay.messages.filter((message) => !known.has(message.id))];
  }, [routedTab, messages, overlay.messages]);

  function setMessages(next: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) {
    setHistory((current) => {
      const base = current.key === historyKey ? current.messages : [];
      return {
        key: historyKey,
        messages: typeof next === "function" ? next(base) : next,
      };
    });
  }

  useEffect(() => {
    if (streamingRef.current) return;
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
  }, [project.id, blockKey, historyKey, refreshToken]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [shown, streaming]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || !editor || streaming) return;
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content,
      createdAt: now(),
    };
    const prior = [...messages, userMessage];
    const assistantId = createId();
    const waiting: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: now(),
    };
    setMessages([...prior, waiting]);
    setDraft("");
    setStreaming(true);
    streamingRef.current = true;
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
          messages: prior.map((message) => ({
            role: message.role,
            content: message.content,
          })),
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
        const next = answer;
        setMessages((current) =>
          current.map((message) => (message.id === assistantId ? { ...message, content: next } : message)),
        );
      }
      const saved = [
        ...prior,
        {
          id: assistantId,
          role: "assistant" as const,
          content: answer,
          createdAt: now(),
        },
      ];
      const savedResponse = await fetch("/api/conversations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          blockId: blockKey,
          messages: saved,
        }),
      });
      const savedData = await savedResponse.json();
      setMessages(savedResponse.ok && Array.isArray(savedData.messages) ? savedData.messages : saved);
      if (answer.trim()) {
        const proposalResponse = await fetch("/api/ai/canvas-proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            mode,
            projectGoal: goal,
            canvas: extractCanvas(editor),
            message: answer,
            block: block
              ? {
                  id: block.id,
                  kind: block.props.kind,
                  title: block.props.title,
                  description: block.props.description,
                }
              : null,
          }),
        });
        const proposalData = await proposalResponse.json();
        if (proposalResponse.ok && Array.isArray(proposalData.proposals) && proposalData.proposals.length > 0) {
          setProposals((current) => ({
            ...current,
            [assistantId]: {
              proposals: proposalData.proposals,
              citations: proposalData.citations ?? [],
            },
          }));
        }
      }
    } catch (caught) {
      setMessages((current) =>
        current.filter((message) => message.id !== assistantId || message.content.trim().length > 0),
      );
      setError(caught instanceof Error ? caught.message : "The architect could not respond.");
    } finally {
      streamingRef.current = false;
      setStreaming(false);
    }
  }

  const working = routedTab !== null && architect.busy;

  // A question typed in Review, Market, Leads, or Engineering stays on that tab.
  function askHere(text: string) {
    const content = text.trim();
    if (!content || !editor || streaming || working) return;
    if (routedTab && architect.ready) {
      setDraft("");
      void architect.ask(content, { tab: routedTab });
      return;
    }
    void send(content);
  }

  const prompt =
    mode === "market"
      ? "Ask what this means for the canvas"
      : mode === "leads"
        ? "Ask who this product is for"
        : mode === "engineering"
          ? "Ask which docs and standards apply"
          : mode === "local"
            ? "Ask about this component"
            : "Ask about the canvas";

  const prompts = suggestions(mode, kind);
  const last = shown.at(-1);
  const showFollowUps =
    !loadingHistory && !streaming && !working && last?.role === "assistant" && last.content.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div ref={scroller} className="forma-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {loadingHistory ? <p className="text-xs text-muted-foreground">Loading conversation…</p> : null}
        {shown.length === 0 && !loadingHistory ? (
          <div className="grid gap-2">
            <p className="text-sm leading-6 text-muted-foreground">{emptyCopy(mode, block)}</p>
            <FollowUps
              items={prompts}
              disabled={streaming || working || !editor}
              onPick={(suggestion) => askHere(suggestion)}
            />
          </div>
        ) : null}
        {shown.map((message) => {
          const waiting = message.role === "assistant" && !message.content && (streaming || working);
          return (
            <div key={message.id}>
              <div
                className={
                  message.role === "user"
                    ? "ml-8 rounded-xl bg-surface-hover px-3 py-2 text-sm leading-6"
                    : "text-sm leading-6 text-foreground"
                }
              >
                {waiting ? <TypingDots /> : message.content ? <MessageBody content={message.content} /> : null}
              </div>
              {proposals[message.id] || overlay.proposals[message.id] ? (
                <ProposalList
                  proposals={(proposals[message.id] ?? overlay.proposals[message.id]).proposals}
                  citations={(proposals[message.id] ?? overlay.proposals[message.id]).citations}
                  editor={editor}
                />
              ) : null}
            </div>
          );
        })}
        {showFollowUps ? (
          <FollowUps items={prompts} disabled={!editor || working} onPick={(suggestion) => askHere(suggestion)} />
        ) : null}
        {routedTab && overlay.status ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {overlay.status}
          </p>
        ) : null}
        {routedTab && overlay.notice ? (
          <p className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs leading-5 text-muted-foreground">
            {overlay.notice}
          </p>
        ) : null}
        {routedTab && overlay.error ? (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger">
            {overlay.error}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          askHere(draft);
        }}
      >
        <Textarea
          value={draft}
          rows={1}
          placeholder={prompt}
          aria-label={prompt}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              askHere(draft);
            }
          }}
        />
        <Button type="submit" variant="accent" className="shrink-0" disabled={streaming || working || !draft.trim() || !editor}>
          <Send className="h-3.5 w-3.5" />
          Send
        </Button>
      </form>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex h-6 items-center gap-1" aria-label="The architect is responding">
      <span className="forma-typing-dot" />
      <span className="forma-typing-dot [animation-delay:160ms]" />
      <span className="forma-typing-dot [animation-delay:320ms]" />
    </span>
  );
}

function FollowUps({
  items,
  disabled,
  onPick,
}: {
  items: string[];
  disabled: boolean;
  onPick: (suggestion: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          disabled={disabled}
          onClick={() => onPick(suggestion)}
          className="rounded-full border border-border px-2.5 py-1 text-left text-xs leading-5 text-muted-foreground hover:border-accent/40 hover:text-foreground disabled:opacity-40"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

function suggestions(mode: ChatMode, kind: BlockKind | "global") {
  if (mode === "engineering") {
    return [
      "Which documentation could we get wrong here?",
      "What security rules must hold before we ship?",
      "Which component carries the most engineering risk?",
    ];
  }
  if (mode === "market") {
    return [
      "What should we change on the pricing decision?",
      "Which kill risk should we write onto the canvas?",
      "Where is the wedge still too vague to build?",
    ];
  }
  if (mode === "leads") {
    return [
      "Who should the first version be for?",
      "What customer decision belongs on the canvas?",
      "Which of these leads matches the wedge?",
    ];
  }
  return suggestionsFor(kind);
}

function emptyCopy(mode: ChatMode, block: CanvasUi["block"]) {
  if (mode === "market") return "Ask what the market finding should change on the canvas.";
  if (mode === "leads") return "Ask who the first version is for.";
  if (mode === "engineering") return "Ask which docs and standards the build has to respect.";
  if (mode === "local" && block) return `Ask how ${block.props.title} should work.`;
  return "Ask what the canvas still leaves undecided.";
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
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-medium">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function now() {
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

async function loadSpecification(projectId: string, blockId: string) {
  if (!blockId) return null;
  const response = await fetch(`/api/specifications?projectId=${projectId}&blockId=${encodeURIComponent(blockId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load the specification.");
  return (data.specification ?? null) as Specification | null;
}
