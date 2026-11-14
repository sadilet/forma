import type { CSSProperties, ReactNode } from "react";
import {
  BadgeCheck,
  Check,
  ClipboardList,
  Code,
  Globe,
  ListChecks,
  Loader2,
  Mic,
  ShieldCheck,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { BLOCK_ICONS } from "@/lib/canvas/block-icons";
import { BLOCK_META, blockInk, type BlockKind } from "@/lib/canvas/kinds";
import { cn } from "@/lib/utils";

// One drawn picture per stage of the thread. Same tokens and block language as the workspace, no sample business,
// no results. They are decorative: the stage's title and text carry the meaning.

const DOT_GRID: CSSProperties = {
  backgroundColor: "var(--canvas-bg)",
  backgroundImage: "radial-gradient(color-mix(in srgb, var(--canvas-grid) 55%, transparent) 1px, transparent 1px)",
  backgroundSize: "22px 22px",
};

function Frame({ children, canvas, className }: { children: ReactNode; canvas?: boolean; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative h-[280px] overflow-hidden rounded-2xl border border-border-strong p-5",
        canvas ? "" : "bg-surface-subtle",
        className,
      )}
      style={canvas ? DOT_GRID : undefined}
    >
      {children}
    </div>
  );
}

function Chip({ kind, title, className }: { kind: BlockKind; title: string; className?: string }) {
  const meta = BLOCK_META[kind];
  const Icon = BLOCK_ICONS[kind];
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2 rounded-lg border bg-surface-elevated px-3 py-2 shadow-soft", className)}
      style={{ borderColor: `${meta.color}66` }}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color: blockInk(meta.color) }} />
      <span className="truncate text-[13px] font-medium">{title}</span>
    </div>
  );
}

function Join({ className }: { className?: string }) {
  return (
    <span className={cn("flex w-6 flex-none items-center text-muted-foreground/60 sm:w-10", className)}>
      <span className="h-px flex-1 bg-current" />
      <svg className="-ml-1 h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 1.5L7 5L3 8.5" />
      </svg>
    </span>
  );
}

function Pointer({ color, label, className }: { color: string; label: string; className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute", className)}>
      <svg width="16" height="18" viewBox="0 0 18 20" aria-hidden="true">
        <path d="M1.5 1.5l6.6 15.6 2.3-6.5 6.5-2.3z" fill={color} stroke="var(--surface-elevated)" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="-mt-0.5 ml-3 block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#101114]" style={{ background: color }}>
        {label}
      </span>
    </div>
  );
}

const WAVE = [8, 14, 22, 12, 26, 16, 9, 18, 10];

export function SketchVisual() {
  return (
    <Frame canvas className="flex flex-col justify-between">
      <div className="flex flex-col gap-9 pt-1">
        <div className="flex items-center">
          <Chip kind="screen" title="Main screen" className="flex-1" />
          <Join />
          <Chip kind="service" title="Service" className="flex-1" />
          <Join className="hidden sm:flex" />
          <Chip kind="database" title="Database" className="hidden flex-1 sm:flex" />
        </div>
        <div className="flex items-center">
          <Chip kind="entity" title="Customer" className="flex-1" />
          <Join />
          <Chip kind="decision" title="Build or buy?" className="flex-1" />
          <Join className="hidden sm:flex" />
          <div className="hidden flex-1 sm:block" />
        </div>
      </div>
      <Pointer color="#6ea8fe" label="Product" className="left-[20%] top-[52%]" />
      <Pointer color="#f0a05a" label="Engineering" className="left-[66%] top-[46%] hidden sm:block" />
      <div className="mx-auto flex h-11 items-center gap-3 rounded-full border border-border-strong bg-glass pl-1.5 pr-4 shadow-panel">
        <span className="forma-voice-live flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-ink">
          <Mic className="h-4 w-4" />
        </span>
        <span className="flex h-7 items-center gap-[3px]">
          {WAVE.map((height, index) => (
            <span key={index} className="w-[3px] rounded-full bg-accent" style={{ height }} />
          ))}
        </span>
        <span className="text-[13px] text-muted-foreground">Listening</span>
      </div>
    </Frame>
  );
}

const PILLARS: { label: string; subtitle: string; Icon: LucideIcon; active?: boolean }[] = [
  { label: "Review", subtitle: "Product gaps", Icon: ClipboardList },
  { label: "Market", subtitle: "Demand & wedge", Icon: Store },
  { label: "Leads", subtitle: "Initial buyers", Icon: Users, active: true },
  { label: "Engineering", subtitle: "Docs & rigor", Icon: ShieldCheck },
];

// Four rows of 40px with 12px gaps: the curves below end at each row's centre.
const ROW_CENTRES = [20, 72, 124, 176];

export function CheckVisual() {
  return (
    <Frame className="flex items-center">
      <div className="grid h-[196px] w-full grid-cols-[auto_1fr_auto] items-stretch">
        <div className="flex items-center">
          <p className="max-w-[8.5rem] rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-[13px] leading-5 sm:max-w-[11rem]">
            Who should I sell to first?
          </p>
        </div>
        <svg viewBox="0 0 100 196" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
          {ROW_CENTRES.map((y, index) => {
            const active = PILLARS[index].active;
            return (
              <path
                key={y}
                d={`M0 98C50 98 50 ${y} 100 ${y}`}
                fill="none"
                stroke={active ? "var(--accent)" : "var(--muted-foreground)"}
                strokeOpacity={active ? 1 : 0.35}
                strokeWidth={active ? 2 : 1.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        <div className="flex flex-col gap-3">
          {PILLARS.map(({ label, subtitle, Icon, active }) => (
            <div
              key={label}
              className={cn(
                "flex h-10 w-[8.5rem] items-center gap-2 rounded-lg border px-3 sm:w-52",
                active ? "border-accent/50 bg-accent-soft text-accent" : "border-border bg-surface-elevated text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={cn("shrink-0 text-[13px] font-medium", active ? "text-foreground" : "")}>{label}</span>
              <span className="hidden truncate text-xs sm:inline">{subtitle}</span>
              {active ? <Check className="ml-auto h-3.5 w-3.5 shrink-0" /> : null}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

const SPEC_ROWS: { text: string; decided: boolean }[] = [
  { text: "Who it is for", decided: true },
  { text: "What happens first", decided: true },
  { text: "How people pay", decided: false },
];

export function SpecVisual() {
  return (
    <Frame className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Chip kind="screen" title="Main screen" />
        <span className="text-[13px] text-muted-foreground">Specification</span>
      </div>
      <ul className="grid gap-1.5 rounded-xl border border-border bg-surface-elevated p-2">
        {SPEC_ROWS.map((row) => (
          <li key={row.text} className="flex h-8 items-center gap-2.5 px-2 text-[13px]">
            {row.decided ? (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-accent text-accent-ink">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : (
              <span className="h-4 w-4 shrink-0 rounded border border-border-strong" />
            )}
            <span className="min-w-0 flex-1 truncate">{row.text}</span>
            {row.decided ? null : (
              <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Undecided</span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] leading-5">
          <span className="font-medium">Proposal</span>
          <span className="text-muted-foreground"> · Add a sign-in screen</span>
        </p>
        <span className="rounded-lg bg-foreground px-2.5 py-1 text-xs font-medium text-background">Accept</span>
        <span className="hidden rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium sm:inline">Ignore</span>
      </div>
    </Frame>
  );
}

const BUILD_STEPS: { label: string; Icon: LucideIcon; state: "done" | "active" }[] = [
  { label: "Plan", Icon: ListChecks, state: "done" },
  { label: "Write", Icon: Code, state: "done" },
  { label: "Check", Icon: BadgeCheck, state: "done" },
  { label: "Ship", Icon: Globe, state: "active" },
];

export function BuildVisual() {
  return (
    <Frame className="flex h-auto flex-col gap-10">
      <ol className="flex items-start pt-2">
        {BUILD_STEPS.map(({ label, Icon, state }, index) => (
          <li key={label} className="contents">
            <div className="flex w-14 flex-col items-center gap-2">
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border",
                  state === "done" ? "border-accent/40 bg-accent-soft text-accent" : "border-accent bg-accent text-accent-ink",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="text-xs font-medium">{label}</span>
            </div>
            {index < BUILD_STEPS.length - 1 ? (
              <span className={cn("mt-5 h-px flex-1", index < 2 ? "bg-accent/50" : "bg-border-strong")} />
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-elevated px-3 py-2.5 shadow-soft">
        <Loader2 className="h-4 w-4 shrink-0 text-accent motion-safe:animate-spin" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Shipping live in prod</span>
        <span className="rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium">Stop</span>
        <span className="hidden rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium sm:inline">Edit</span>
      </div>
    </Frame>
  );
}
