import Link from "next/link";
import { ArrowRight, ArrowUpRight, ClipboardList, ShieldCheck, Store, Users, type LucideIcon } from "lucide-react";
import { Logo, LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-provider";
import { Button } from "@/components/ui";
import { BuildVisual, CheckVisual, SketchVisual, SpecVisual } from "@/components/landing/stage-visuals";
import { HeroVideo } from "@/components/landing/hero-video";
import { videoSource, type VideoSource } from "@/components/landing/video-source";
import { WorkspacePreview } from "@/components/landing/workspace-preview";
import { cn } from "@/lib/utils";

// An app Forma planned from a canvas, wrote, checked, and shipped to Cloud Run.
export const DEMO_URL = "https://forma-project-slotguard-833871905956.europe-north1.run.app/";
const DEMO_HOST = DEMO_URL.replace(/^https:\/\//, "").replace(/\/$/, "");

const container = "mx-auto w-full max-w-6xl px-6";
const h2 = "text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl md:text-[44px]";
const body = "text-pretty text-base leading-7 text-muted-foreground sm:text-[17px] sm:leading-8";
const focusRing =
  "rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#architect", label: "Architect" },
  { href: "#next", label: "What is next" },
];

const STAGES = [
  {
    title: "Sketch",
    text: "Draw the product on a shared infinite canvas, with blocks for screens, services, databases, entities, decisions, and notes. A partner opens the same workspace and you see their cursor. Prefer to talk it through? The voice collaborator can see the canvas while you do.",
    Visual: SketchVisual,
  },
  {
    title: "Check it against the world",
    text: "An AI collaborator sits in the room and researches while you work. Ask in the bar at the bottom of the canvas and it routes the question to Review, Market, Leads, or Engineering, running the research that answer depends on.",
    Visual: CheckVisual,
  },
  {
    title: "Settle the spec",
    text: "Specs live on the blocks they describe. The Architect points at what is still missing or undecided, and proposes changes to the canvas that you accept or ignore. When the team agrees, the spec is done.",
    Visual: SpecVisual,
  },
  {
    title: "Build",
    text: "Hit Build. Forma plans the app, writes it, checks it, and ships it live in prod. The address stays the same across deploys, and you can stop, edit, or override before anything ships.",
    Visual: BuildVisual,
  },
];

const PILLARS: { label: string; subtitle: string; text: string; Icon: LucideIcon }[] = [
  {
    label: "Review",
    subtitle: "Product gaps",
    text: "What is missing or unresolved on the canvas, ranked by severity, with a link to the block it is about.",
    Icon: ClipboardList,
  },
  {
    label: "Market",
    subtitle: "Demand and wedge",
    text: "Named competitors, a read on demand, and the place where your idea has room.",
    Icon: Store,
  },
  {
    label: "Leads",
    subtitle: "Initial buyers",
    text: "Real buyers you could actually contact, with outreach drafted for you to edit.",
    Icon: Users,
  },
  {
    label: "Engineering",
    subtitle: "Docs and rigor",
    text: "Current official docs and standards, mapped to your blocks, so the build follows the world as it is today.",
    Icon: ShieldCheck,
  },
];

const NOT_YET = [
  { title: "Live documentation", text: "Docs that stay in step with the build as it changes." },
  { title: "A decision audit trail", text: "Who decided what, and why, kept alongside the product." },
  { title: "One-click rollbacks", text: "Forma keeps the previous version of your app today. Rolling back from the product is still to come." },
  { title: "Production-hardened code", text: "The same thread, carried from a demo you can show a buyer into production." },
];

const TABS = ["Search", "A chat", "Another chat", "Notes", "Spec draft", "Competitors", "Repo"];

function SignInLink({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <Button asChild variant="quiet" className={className}>
      <Link href={signedIn ? "/projects" : "/login"}>{signedIn ? "Workspaces" : "Sign in"}</Link>
    </Button>
  );
}

function GetStartedLink({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <Button asChild variant="accent" className={className}>
      <Link href={signedIn ? "/projects" : "/login"}>
        Get started
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Button>
  );
}

function DemoLink({ className, variant = "primary" }: { className?: string; variant?: "primary" | "quiet" }) {
  return (
    <Button asChild variant={variant} className={className}>
      <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
        <span className="sm:hidden">See the app</span>
        <span className="hidden sm:inline">See an app Forma built</span>
        <ArrowUpRight className="h-4 w-4" aria-hidden />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  );
}

function Header({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-glass backdrop-blur-md">
      <div className={cn(container, "flex h-14 items-center gap-6")}>
        <Link href="/" aria-label="Forma home" className={focusRing}>
          <Logo />
        </Link>
        <nav aria-label="Sections" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <SignInLink signedIn={signedIn} className="h-9 px-3 text-[13px]" />
          <DemoLink className="h-9 px-3 text-[13px] max-sm:[&_svg]:hidden" />
        </div>
      </div>
    </header>
  );
}

function Hero({ signedIn, video }: { signedIn: boolean; video: VideoSource | null }) {
  return (
    <section className="pt-16 sm:pt-24">
      <div className={cn(container, video ? "grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14" : "")}>
        <div>
          <h1
            className={cn(
              "max-w-3xl text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-6xl",
              video ? "lg:text-[52px] xl:text-[58px]" : "lg:text-[68px]",
            )}
          >
            Figure out the product. Then build it from the same room.
          </h1>
          <p className={cn(body, "mt-6 max-w-xl text-lg")}>
            Forma is a real-time studio where you sketch the idea, check it against the real world with an AI
            collaborator, settle the spec with your team, and hit Build. The thinking and the building stay on one
            thread.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <DemoLink className="h-11 px-5 text-[15px]" />
            <SignInLink signedIn={signedIn} className="h-11 px-5 text-[15px]" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Sign-in uses two demo accounts for now.</p>
        </div>
        {video ? <HeroVideo source={video} /> : null}
      </div>
      <div className={cn(container, "mt-14 sm:mt-20")}>
        <WorkspacePreview />
        <p className="mt-3 text-xs text-muted-foreground">An illustration of the workspace. The product on the canvas is a placeholder.</p>
      </div>
    </section>
  );
}

function TabPile() {
  return (
    <div aria-hidden="true" className="flex items-end gap-1 overflow-hidden border-b border-border-strong">
      {TABS.map((tab, index) => (
        <span
          key={tab}
          className={cn(
            "h-9 min-w-0 flex-1 items-center truncate rounded-t-lg border border-b-0 border-border bg-surface-subtle px-3 text-xs leading-9 text-muted-foreground",
            index > 3 ? "hidden sm:block" : "block",
          )}
        >
          {tab}
        </span>
      ))}
      <span className="-mb-px flex h-10 flex-[2] items-center gap-2 rounded-t-lg border border-b-0 border-border-strong bg-background px-3 text-[13px] font-medium">
        <LogoMark size={14} className="text-accent" />
        Forma
      </span>
    </div>
  );
}

function Problem() {
  return (
    <section className="py-24 sm:py-32">
      <div className={container}>
        <TabPile />
        <div className="mt-14 grid gap-8 md:grid-cols-[1.25fr_1fr] md:gap-16">
          <h2 className={h2}>
            AI changed how code gets written. Building a product is still slow, because the hard part is the context
            scattered between research, specs, and engineering.
          </h2>
          <div className="md:pt-2">
            <p className={body}>
              A founder with an idea ends up with a pile of tabs: a search, a few chats, a doc, a repo. Each one knows a
              piece, and none of them know the product.
            </p>
            <p className={cn(body, "mt-5 text-foreground")}>
              Forma keeps market research, the spec, and the engineering in one room, so the build comes out of the work
              that justified it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="scroll-mt-14 border-t border-border py-24 sm:py-32">
      <div className={cn(container, "grid gap-12 md:grid-cols-[1fr_1.4fr] md:gap-20")}>
        <div className="md:sticky md:top-28 md:self-start">
          <h2 className={h2}>One thread, from the first sketch to a build you still direct.</h2>
          <p className={cn(body, "mt-5 max-w-md")}>
            You do not start with an empty repo. You start with the idea, and every step after it builds on what the
            last one found.
          </p>
        </div>
        <ol className="divide-y divide-border border-y border-border">
          {STAGES.map(({ title, text, Visual }) => (
            <li key={title} className="py-10 first:pt-0 last:pb-10">
              <Visual />
              <h3 className="mt-6 text-xl font-semibold tracking-[-0.02em]">{title}</h3>
              <p className={cn(body, "mt-3 max-w-xl")}>{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Architect() {
  return (
    <section id="architect" className="scroll-mt-14 border-t border-border bg-surface-subtle py-24 sm:py-32">
      <div className={container}>
        <h2 className={cn(h2, "max-w-3xl")}>Grounded in the real world, so you build for reality.</h2>
        <p className={cn(body, "mt-5 max-w-xl")}>
          The Architect is the AI collaborator in your workspace. It works through four pillars, and each one pulls in
          the real world instead of guessing.
        </p>
        <dl className="mt-14 grid gap-x-16 gap-y-12 sm:grid-cols-2">
          {PILLARS.map(({ label, subtitle, text, Icon }) => (
            <div key={label} className="border-t border-border-strong pt-6">
              <dt className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="text-lg font-semibold tracking-[-0.02em]">{label}</span>
                <span className="text-sm text-muted-foreground">{subtitle}</span>
              </dt>
              <dd className={cn(body, "mt-4 max-w-md")}>{text}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-12 grid gap-3 border-t border-border-strong pt-6 sm:grid-cols-2 sm:gap-16">
          <h3 className="text-lg font-semibold tracking-[-0.02em]">You stay in the driver&apos;s seat.</h3>
          <p className="text-base leading-7 text-muted-foreground">
            The Architect proposes, and you steer, edit, or override. Nothing ships until you say so.
          </p>
        </div>
      </div>
    </section>
  );
}

function Demo() {
  return (
    <section className="border-t border-border py-24 sm:py-32">
      <div className={container}>
        <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center md:gap-20">
          <div>
            <h2 className={h2}>See what a canvas turns into.</h2>
            <p className={cn(body, "mt-5 max-w-md")}>
              This is a running app that Forma planned from a canvas, wrote, checked, and shipped live.
              Generated apps simulate payments, email, and SMS, and have no real login yet.
            </p>
          </div>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group block overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-panel transition-shadow hover:shadow-float focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <span className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="flex min-w-0 flex-1 items-center rounded-lg bg-muted px-3 py-1.5 text-[13px] text-muted-foreground">
                <span className="truncate">{DEMO_HOST}</span>
              </span>
            </span>
            <span className="flex items-center justify-between gap-4 px-6 py-10 sm:py-14">
              <span className="flex flex-col gap-1">
                <span className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">SlotGuard</span>
                <span className="text-base text-muted-foreground">See an app Forma built</span>
              </span>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                <ArrowUpRight className="h-5 w-5" aria-hidden />
                <span className="sr-only">Opens in a new tab</span>
              </span>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

function Next() {
  return (
    <section id="next" className="scroll-mt-14 border-t border-border bg-surface-subtle py-24 sm:py-32">
      <div className={cn(container, "grid gap-12 md:grid-cols-[1fr_1.4fr] md:gap-20")}>
        <div>
          <h2 className={h2}>Where Forma is going.</h2>
          <p className={cn(body, "mt-5 max-w-md")}>
            Forma takes you from a first sketch to a checked, running build today. These are the next pieces, and they
            are not in the product yet.
          </p>
        </div>
        <ul className="divide-y divide-border border-y border-border">
          {NOT_YET.map((item) => (
            <li key={item.title} className="flex flex-col gap-1 py-6 sm:flex-row sm:items-baseline sm:gap-8">
              <h3 className="text-base font-semibold sm:w-56 sm:shrink-0">{item.title}</h3>
              <p className="text-[15px] leading-7 text-muted-foreground">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Close({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="py-24 sm:py-32">
      <div className={container}>
        <div className="rounded-3xl border border-border bg-surface px-6 py-14 shadow-panel sm:px-14 sm:py-20">
          <h2 className="max-w-2xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
            Start with the idea, not an empty repo.
          </h2>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <GetStartedLink signedIn={signedIn} className="h-11 px-5 text-[15px]" />
            <DemoLink variant="quiet" className="h-11 px-5 text-[15px]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="border-t border-border py-8">
      <div className={cn(container, "flex flex-wrap items-center justify-between gap-4")}>
        <Logo />
        <nav aria-label="Footer" className="flex items-center gap-5 text-sm text-muted-foreground">
          <Link href={signedIn ? "/projects" : "/login"} className={cn(focusRing, "hover:text-foreground")}>
            {signedIn ? "Workspaces" : "Sign in"}
          </Link>
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={cn(focusRing, "hover:text-foreground")}>
            See an app Forma built
          </a>
        </nav>
      </div>
    </footer>
  );
}

export function LandingPage({ signedIn, videoUrl }: { signedIn: boolean; videoUrl?: string }) {
  return (
    <div data-landing className="min-h-screen bg-background">
      <Header signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} video={videoSource(videoUrl)} />
        <Problem />
        <How />
        <Architect />
        <Demo />
        <Next />
        <Close signedIn={signedIn} />
      </main>
      <Footer signedIn={signedIn} />
    </div>
  );
}
