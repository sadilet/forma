import type { CSSProperties } from "react";
import { Check, ClipboardList, Loader2, Mic, ArrowUp, ShieldCheck, Store, Users } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { BLOCK_ICONS } from "@/lib/canvas/block-icons";
import { BLOCK_META, blockInk, type BlockKind } from "@/lib/canvas/kinds";

// An illustration of the workspace, drawn from the app's own tokens and block styles. The blocks are a generic product on purpose:
// no sample business, no results, only the room and what it is doing. The stage is a fixed 800 x 580 plane so arrows and cursors line up.
const W = 800;
const H = 580;
const BLOCK_W = 190;

type PreviewBlock = { kind: BlockKind; title: string; copy: string; x: number; y: number };

const BLOCKS: PreviewBlock[] = [
  { kind: "entity", title: "Customer", copy: "The person this is built for.", x: 36, y: 50 },
  { kind: "screen", title: "Main screen", copy: "Where they land and what they do first.", x: 305, y: 50 },
  { kind: "service", title: "Service", copy: "Does the work behind the screen.", x: 574, y: 50 },
  { kind: "note", title: "Open question", copy: "Who pays first, and why?", x: 36, y: 270 },
  { kind: "decision", title: "Build or buy?", copy: "Settle it once, with the reason.", x: 305, y: 270 },
  { kind: "database", title: "Database", copy: "What the product has to remember.", x: 574, y: 270 },
];

// Edges run between block borders. Horizontal ones sit at the middle of a row, vertical ones at a block's centre.
const EDGES: { from: [number, number]; to: [number, number]; delay: number }[] = [
  { from: [226, 107], to: [305, 107], delay: 150 },
  { from: [495, 107], to: [574, 107], delay: 450 },
  { from: [400, 160], to: [400, 270], delay: 750 },
  { from: [669, 160], to: [669, 270], delay: 1000 },
  { from: [226, 327], to: [305, 327], delay: 1250 },
  { from: [495, 327], to: [574, 327], delay: 1500 },
];

const PILLARS = [
  { label: "Review", Icon: ClipboardList },
  { label: "Market", Icon: Store },
  { label: "Leads", Icon: Users },
  { label: "Engineering", Icon: ShieldCheck },
];

const STEPS: { text: string; state: "done" | "active" | "todo" }[] = [
  { text: "Read the canvas", state: "done" },
  { text: "Searched current sources", state: "done" },
  { text: "Naming competitors", state: "active" },
  { text: "Finding the wedge", state: "todo" },
];

function pct(value: number, total: number) {
  return `${(value / total) * 100}%`;
}

function Edge({ from, to, delay }: (typeof EDGES)[number]) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const horizontal = y1 === y2;
  const head = horizontal ? `M${x2 - 6} ${y2 - 4}L${x2} ${y2}L${x2 - 6} ${y2 + 4}` : `M${x2 - 4} ${y2 - 6}L${x2} ${y2}L${x2 + 4} ${y2 - 6}`;
  const style = { "--d": `${delay}ms` } as CSSProperties;
  return (
    <g stroke="var(--muted-foreground)" strokeOpacity="0.55" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path className="landing-edge" pathLength={1} d={`M${x1} ${y1}L${x2} ${y2}`} style={style} />
      <path className="landing-edge-head" d={head} style={style} />
    </g>
  );
}

function Block({ kind, title, copy, x, y }: PreviewBlock) {
  const meta = BLOCK_META[kind];
  const Icon = BLOCK_ICONS[kind];
  return (
    <div
      className="md:absolute md:left-[var(--x)] md:top-[var(--y)] md:w-[var(--w)]"
      style={{ "--x": pct(x, W), "--y": pct(y, H), "--w": pct(BLOCK_W, W) } as CSSProperties}
    >
      <div className="forma-block" style={{ borderColor: `${meta.color}55` }}>
        <span className="forma-block-accent" style={{ background: meta.color }} />
        <div className="forma-block-body">
          <div className="forma-block-kicker" style={{ color: blockInk(meta.color) }}>
            <Icon className="forma-block-kind-icon" aria-hidden />
            {meta.label}
          </div>
          <div className="forma-block-title">{title}</div>
          <div className="forma-block-copy">{copy}</div>
        </div>
        <span className="forma-block-explore" style={{ cursor: "default" }}>
          Explore
        </span>
      </div>
    </div>
  );
}

function Cursor({ x, y, color, label, delay }: { x: number; y: number; color: string; label: string; delay: number }) {
  return (
    <div
      className="pointer-events-none absolute hidden md:block"
      style={{ left: pct(x, W), top: pct(y, H) }}
    >
      <div className="landing-cursor" style={{ "--d": `${delay}ms` } as CSSProperties}>
        <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
          <path d="M1.5 1.5l6.6 15.6 2.3-6.5 6.5-2.3z" fill={color} stroke="var(--surface-elevated)" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span
          className="-mt-0.5 ml-3.5 block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#101114]"
          style={{ background: color }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function Avatar({ letter, color }: { letter: string; color: string }) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-[#101114] ring-2 ring-surface"
      style={{ background: color }}
    >
      {letter}
    </span>
  );
}

function Architect() {
  return (
    <aside className="hidden flex-col border-l border-border bg-surface lg:flex">
      <div className="flex h-11 items-center border-b border-border px-4 text-[13px] font-medium">Architect</div>
      <div className="flex gap-1 border-b border-border p-2">
        {PILLARS.map(({ label, Icon }) => {
          const active = label === "Market";
          return (
            <span
              key={label}
              className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium ${
                active ? "flex-1 bg-accent-soft text-accent" : "w-9 text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {active ? label : <span className="sr-only">{label}</span>}
            </span>
          );
        })}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <p className="ml-6 rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[13px] leading-5">
          Who are my competitors, and where is the wedge?
        </p>
        <div className="rounded-xl border border-border bg-surface-subtle p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Routed to Market</p>
          <ul className="mt-3 grid gap-2.5">
            {STEPS.map((step) => (
              <li key={step.text} className="flex items-center gap-2 text-[13px]">
                {step.state === "done" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                ) : step.state === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 text-accent motion-safe:animate-spin" aria-hidden />
                ) : (
                  <span className="mx-[3px] h-2 w-2 shrink-0 rounded-full border border-border-strong" aria-hidden />
                )}
                <span className={step.state === "todo" ? "text-muted-foreground" : "text-foreground"}>{step.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-auto text-xs leading-5 text-muted-foreground">
          Answers land in the Market tab. Proposals to change the canvas wait for you to accept them.
        </p>
      </div>
    </aside>
  );
}

function AskBar() {
  return (
    <div className="mx-auto w-full max-w-[26rem] md:absolute md:inset-x-0 md:bottom-6 md:w-[62%] md:max-w-none">
      <div className="mb-2 flex justify-center">
        <div className="flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted-foreground shadow-soft">
          <Store className="h-3 w-3 shrink-0" aria-hidden />
          <span className="shrink-0 font-medium text-foreground">Flagged as Market</span>
          <span className="truncate">· Naming competitors…</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border-strong bg-glass pl-4 pr-2 shadow-panel">
          <span className="min-w-0 flex-1 truncate text-[13px]">Who are my competitors, and where is the wedge?</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border-strong bg-glass text-muted-foreground shadow-panel">
          <Mic className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </div>
  );
}

export function WorkspacePreview() {
  return (
    <div
      role="img"
      aria-label="The Forma workspace: a shared canvas of product blocks with two collaborators' cursors, the Architect panel working on a market question, and the question bar at the bottom."
      className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-float"
    >
      <div className="flex h-11 items-center gap-3 border-b border-border px-4">
        <LogoMark size={16} className="text-foreground" />
        <span className="text-[13px] font-medium">Untitled product</span>
        <span className="ml-auto flex -space-x-1.5">
          <Avatar letter="P" color="#6ea8fe" />
          <Avatar letter="E" color="#f0a05a" />
        </span>
        <span className="flex h-7 items-center rounded-lg bg-accent px-2.5 text-xs font-medium text-accent-ink">Build</span>
      </div>
      <div className="grid lg:grid-cols-[1fr_280px]">
        <div
          className="relative flex flex-col gap-6 p-4 md:block md:aspect-[800/580] md:p-0"
          style={{
            backgroundColor: "var(--canvas-bg)",
            backgroundImage: "radial-gradient(color-mix(in srgb, var(--canvas-grid) 55%, transparent) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
            aria-hidden="true"
          >
            {EDGES.map((edge) => (
              <Edge key={edge.delay} {...edge} />
            ))}
          </svg>
          <div className="grid grid-cols-2 gap-3 md:contents">
            {BLOCKS.map((block) => (
              <Block key={block.title} {...block} />
            ))}
          </div>
          <Cursor x={432} y={196} color="#6ea8fe" label="Product" delay={0} />
          <Cursor x={672} y={392} color="#f0a05a" label="Engineering" delay={1800} />
          <AskBar />
        </div>
        <Architect />
      </div>
    </div>
  );
}
