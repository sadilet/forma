"use client";

import { useRef, useState, type ComponentProps } from "react";
import { ArrowUp, ClipboardList, Loader2, ShieldCheck, Store, Users, type LucideIcon } from "lucide-react";
import { useArchitectLive } from "@/components/workspace/architect/architect-live";
import { VoiceControl } from "@/components/workspace/voice-control";
import { TAB_META, type ArchitectTab } from "@/lib/architect/tabs";
import { cn } from "@/lib/utils";

export const TAB_ICON: Record<ArchitectTab, LucideIcon> = {
  review: ClipboardList,
  market: Store,
  leads: Users,
  engineering: ShieldCheck,
};

// One way into each pillar. Picking one still goes through the Decisions API, so it shows how routing works.
const STARTERS: { tab: ArchitectTab; text: string }[] = [
  { tab: "review", text: "I want a booking app for local salons" },
  { tab: "review", text: "What is still undecided on this canvas?" },
  { tab: "market", text: "Who are my competitors and what do they charge?" },
  { tab: "leads", text: "Who should I sell to first?" },
];

type VoiceProps = Omit<ComponentProps<typeof VoiceControl>, "className">;

export function CommandBar({ onOpenTab, ...voice }: VoiceProps & { onOpenTab: (tab: ArchitectTab) => void }) {
  const { ask, busy, ready, phase, flagged } = useArchitectLive();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const canSend = ready && !busy && draft.trim().length > 0;

  function resize() {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 128)}px`;
  }

  function submit(text: string) {
    const question = text.trim();
    if (!question || !ready || busy) return;
    setDraft("");
    requestAnimationFrame(resize);
    void ask(question);
  }

  const showStarters = focused && !busy && draft.length === 0 && ready;

  return (
    <div className="flex w-[min(42rem,100%)] flex-col items-stretch gap-2">
      <div className="flex min-h-7 items-end justify-center">
        {showStarters ? (
          <div className="grid w-full grid-cols-2 gap-1.5" role="list" aria-label="Suggested questions">
            {STARTERS.map(({ tab, text }) => {
              const Icon = TAB_ICON[tab];
              return (
                <button
                  key={text}
                  type="button"
                  role="listitem"
                  // Keep focus in the field while the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => submit(text)}
                  className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-left text-xs text-muted-foreground shadow-soft hover:border-accent/40 hover:text-foreground"
                >
                  <Icon className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{text}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <RoutePill onOpenTab={onOpenTab} />
        )}
      </div>

      <div className="flex items-end gap-2">
        <form
          className="flex min-w-0 flex-1 items-end gap-2 rounded-3xl border border-border-strong bg-surface-elevated py-1.5 pl-4 pr-1.5 shadow-panel transition-colors focus-within:border-accent/70"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <textarea
            ref={field}
            value={draft}
            rows={1}
            disabled={!ready}
            aria-label="Ask the architect anything"
            placeholder={ready ? "Ask anything about your product" : "Loading the canvas…"}
            onChange={(event) => {
              setDraft(event.target.value);
              resize();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.blur();
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit(draft);
              }
            }}
            className="max-h-32 min-h-9 w-full min-w-0 resize-none bg-transparent py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label={busy ? "The architect is working" : "Send"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-surface-hover disabled:text-muted-foreground"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="h-4 w-4" aria-hidden />
            )}
          </button>
        </form>
        <VoiceControl {...voice} className="h-12 w-12" />
      </div>
      <span className="sr-only" aria-live="polite">
        {flagged && phase.kind !== "idle" ? pillText(phase, flagged.tab) : ""}
      </span>
    </div>
  );
}

function pillText(phase: ReturnType<typeof useArchitectLive>["phase"], tab: ArchitectTab) {
  const label = TAB_META[tab].label;
  if (phase.kind === "working") return `Flagged as ${label} · ${phase.step}…`;
  if (phase.kind === "answering") return `Flagged as ${label} · Answering…`;
  if (phase.kind === "done") return `Answered in ${label}`;
  return `Flagged as ${label}`;
}

function RoutePill({ onOpenTab }: { onOpenTab: (tab: ArchitectTab) => void }) {
  const { phase, flagged } = useArchitectLive();
  if (phase.kind === "idle") return null;

  if (phase.kind === "routing") {
    return (
      <Pill>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Working out where this belongs…
      </Pill>
    );
  }

  const tab = phase.tab;
  const Icon = TAB_ICON[tab];
  const busy = phase.kind !== "done";
  const confidence = flagged?.confidence;
  return (
    <Pill
      onClick={() => onOpenTab(tab)}
      title={
        confidence !== null && confidence !== undefined
          ? `${Math.round(confidence * 100)}% sure this is a ${TAB_META[tab].label.toLowerCase()} question. Open ${TAB_META[tab].label}.`
          : `Open ${TAB_META[tab].label}`
      }
    >
      {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden /> : <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="shrink-0 font-medium text-foreground">
        {phase.kind === "done"
          ? `Answered in ${TAB_META[tab].label}`
          : (flagged?.label ?? `Flagged as ${TAB_META[tab].label}`)}
      </span>
      {phase.kind === "working" ? <span className="truncate">· {phase.step}…</span> : null}
      {phase.kind === "answering" ? <span className="truncate">· Answering…</span> : null}
    </Pill>
  );
}

function Pill({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  const className =
    "flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted-foreground shadow-soft";
  if (!onClick) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={onClick} title={title} className={cn(className, "hover:border-accent/40")}>
      {children}
    </button>
  );
}
