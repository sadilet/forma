"use client";

import { ExternalLink, Rocket, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Editor } from "tldraw";
import { Button } from "@/components/ui";
import { extractCanvas } from "@/lib/canvas/extract";
import { DEPLOY_STAGES } from "@/lib/deploy/contract";
import type { DeployEvent, DeployJob, DeployStage } from "@/lib/deploy/contract";
import type { ProjectRecord } from "@/lib/projects";

// The only piece of the deploy module that sits in the workspace screen: a button and a status panel.
// It reads the canvas, asks the server to deploy it, and shows the log while the worker does the work.

const STEPS: { stage: DeployStage; label: string }[] = [
  { stage: "plan", label: "Plan" },
  { stage: "build", label: "Build" },
  { stage: "ship", label: "Ship" },
  { stage: "verify", label: "Check" },
];

const isActive = (job: DeployJob | null) => job?.status === "queued" || job?.status === "running";

export function DeployDock({ project, editor }: { project: ProjectRecord; editor: Editor | null }) {
  return <DeployPanel project={project} editor={editor} />;
}

function DeployPanel({ project, editor }: { project: ProjectRecord; editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<DeployJob | null>(null);
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const jobIdRef = useRef<string | null>(null);
  const afterRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const query = new URLSearchParams({ projectId: project.id, after: String(afterRef.current) });
      if (jobIdRef.current) query.set("jobId", jobIdRef.current);
      const response = await fetch(`/api/deploy?${query}`);
      if (!response.ok) return;
      const data = (await response.json()) as { job: DeployJob | null; events: DeployEvent[]; reset: boolean; serverTime: number };
      setNow(data.serverTime);
      setJob(data.job);
      jobIdRef.current = data.job?.id ?? null;
      setEvents((current) => (data.reset ? data.events : [...current, ...data.events]));
      afterRef.current = data.events.length > 0 ? data.events[data.events.length - 1].id : data.reset ? 0 : afterRef.current;
    } catch {
      // The next poll tries again. A dropped request is not worth a message.
    }
  }, [project.id]);

  // Load the last deploy once, then keep polling while the panel is open or a deploy is running.
  const polling = open || isActive(job);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [events.length, open]);

  async function start() {
    if (!editor) return;
    setStarting(true);
    try {
      const response = await fetch("/api/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, canvas: extractCanvas(editor) }),
      });
      const data = (await response.json()) as { job?: DeployJob; error?: string };
      if (!response.ok || !data.job) {
        toast.error(data.error ?? "The deploy could not be started.");
        return;
      }
      setOpen(true);
      await refresh();
    } catch {
      toast.error("The deploy could not be started. Check your connection.");
    } finally {
      setStarting(false);
    }
  }

  const active = isActive(job);
  const waitingForWorker = job?.status === "queued" && now - job.createdAt > 8000;
  const dot = active ? "bg-accent animate-pulse" : job?.status === "succeeded" ? "bg-emerald-400" : job?.status === "failed" ? "bg-red-400" : "";

  return (
    <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
      <Button variant={open ? "accent" : "quiet"} size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Rocket className="h-3.5 w-3.5" />
        Deploy
        {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden /> : null}
      </Button>

      {open ? (
        <section
          aria-label="Deploy"
          className="flex max-h-[70vh] w-[min(380px,calc(100vw-24px))] flex-col gap-3 rounded-2xl border border-border bg-[#14161b] p-4 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Deploy {project.name}</h2>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Writes the app from this canvas and puts it online on Google Cloud Run. Edit the canvas and deploy again to update it.
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {job ? <Steps job={job} /> : null}

          {job?.status === "succeeded" && job.url ? (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-400/15"
            >
              <span className="min-w-0 truncate">{job.url}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : null}
          {job?.status === "succeeded" && !job.url ? (
            <p className="rounded-lg border border-border bg-white/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
              Dry run finished. The app was prepared, but nothing was deployed.
            </p>
          ) : null}
          {job?.status === "failed" ? (
            <div className="grid gap-2">
              <p className="whitespace-pre-wrap break-words rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-200">
                {job.error ?? "The deploy failed."}
              </p>
              {job.url ? (
                <a href={job.url} target="_blank" rel="noreferrer" className="truncate text-xs text-muted-foreground underline">
                  {job.url}
                </a>
              ) : null}
            </div>
          ) : null}
          {waitingForWorker ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
              Waiting for the deploy worker. Start it in a terminal with <code className="font-mono">npm run deploy:worker</code>.
            </p>
          ) : null}

          {events.length > 0 ? (
            <div
              ref={logRef}
              role="log"
              aria-label="Deploy log"
              className="min-h-24 flex-1 overflow-y-auto rounded-lg border border-border bg-black/30 p-2 font-mono text-[11px] leading-5"
            >
              {events.map((event) => (
                <div
                  key={event.id}
                  className={event.level === "error" ? "text-red-300" : event.level === "warn" ? "text-amber-200" : "text-muted-foreground"}
                >
                  <span className="mr-2 opacity-50">{new Date(event.at).toLocaleTimeString([], { hour12: false })}</span>
                  {event.message}
                </div>
              ))}
            </div>
          ) : null}

          <Button variant="primary" onClick={() => void start()} disabled={!editor || starting || active}>
            {active ? "Deploying…" : starting ? "Starting…" : job ? "Deploy again" : "Deploy"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function Steps({ job }: { job: DeployJob }) {
  const current = DEPLOY_STAGES.indexOf(job.stage);
  return (
    <ol className="flex items-center gap-1.5 text-[11px]" aria-label="Deploy steps">
      {STEPS.map((step, index) => {
        const at = DEPLOY_STAGES.indexOf(step.stage);
        const done = job.status === "succeeded" || (job.status !== "queued" && at < current);
        const here = at === current && job.status !== "queued" && job.status !== "succeeded";
        const failed = here && job.status === "failed";
        const tone = failed
          ? "border-red-400/40 bg-red-400/10 text-red-200"
          : done
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            : here
              ? "border-accent/50 bg-accent/10 text-foreground"
              : "border-border text-muted-foreground";
        return (
          <li key={step.stage} className="flex items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 ${tone}`}>{step.label}</span>
            {index < STEPS.length - 1 ? <span className="h-px w-3 bg-white/10" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
