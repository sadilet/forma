// Shared types for the deploy module. Everything in src/lib/deploy runs both in Next.js and in the
// standalone worker (node --experimental-strip-types), so files here use relative imports ending in .ts
// and `import type` for types. Do not import "@/..." aliases or "server-only" from this folder.

export const DEPLOY_STAGES = ["queued", "plan", "build", "ship", "verify", "done"] as const;
export type DeployStage = (typeof DEPLOY_STAGES)[number];

export type DeployStatus = "queued" | "running" | "succeeded" | "failed";
export type EventLevel = "info" | "warn" | "error";

// The project template a deploy was started from (blank, taskflow, meetings, slotguard, ...).
// Any project can be deployed: the app builder writes the app from the canvas.
export type DeployTemplate = string;

// Ready-made apps that can be shipped without the app builder. Each one is a folder in deploy-templates/.
// They are a fallback for a machine with no AI key (DEPLOY_BUILDER=reference); they do not follow canvas edits.
export const REFERENCE_TEMPLATES = ["slotguard"] as const;

export function hasReferenceApp(template: string): boolean {
  return (REFERENCE_TEMPLATES as readonly string[]).includes(template);
}

export type DeployJob = {
  id: string;
  projectId: string;
  requestedBy: string;
  status: DeployStatus;
  stage: DeployStage;
  template: DeployTemplate;
  serviceName: string;
  url: string | null;
  revision: string | null;
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
};

export type DeployEvent = {
  id: number;
  jobId: string;
  at: number;
  stage: DeployStage;
  level: EventLevel;
  message: string;
};

export type PlanTaskKind = "scaffold" | "data" | "service" | "screen" | "integrate";

export type PlanTask = {
  id: string;
  kind: PlanTaskKind;
  title: string;
  // Canvas blocks this task implements.
  blockIds: string[];
  // Tasks that must be finished first.
  dependsOn: string[];
  goal: string;
  // Decisions and notes from the canvas that bind this task.
  constraints: string[];
  acceptance: string[];
};

export type BuildPlan = {
  version: 1;
  summary: string;
  // Topological order. A task only depends on tasks that appear before it.
  tasks: PlanTask[];
  warnings: string[];
};

// A worker that stops sending heartbeats for this long loses its job to the queue.
export const HEARTBEAT_MS = 10_000;
export const STALE_LOCK_MS = 60_000;
// A job that crashed its worker is retried once more, then marked failed.
export const MAX_ATTEMPTS = 2;