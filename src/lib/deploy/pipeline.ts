import type Database from "better-sqlite3";
import { prepareRepo } from "./build.ts";
import type { DeployConfig } from "./config.ts";
import type { DeployStage, EventLevel } from "./contract.ts";
import { deployFromSource } from "./gcloud.ts";
import type { Shipped } from "./gcloud.ts";
import { planFromSnapshot } from "./planner.ts";
import type { RunOptions } from "./process.ts";
import {
  addEvent,
  finishFailure,
  finishSuccess,
  recordShipped,
  releaseJob,
  savePlan,
  setStage,
} from "./queue.ts";
import type { ClaimedJob } from "./queue.ts";

// One deploy from start to finish: plan, build, ship to Cloud Run, check that it answers.

export type PipelineDeps = {
  ship: (
    config: DeployConfig,
    input: { serviceName: string; projectId: string; releaseId: string; sourceDir: string },
    options: RunOptions,
  ) => Promise<Shipped>;
  // True when the service answers /api/health with 200.
  health: (url: string, signal: AbortSignal) => Promise<boolean>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const realDeps: PipelineDeps = {
  ship: deployFromSource,
  health: async (url, signal) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
      if (response.status !== 200) return false;
      const body = (await response.json()) as { ok?: unknown };
      return body.ok === true;
    } catch {
      return false;
    }
  },
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    }),
};

export type JobOutcome = "succeeded" | "failed" | "released" | "lost";

const SHIP_TIMEOUT_MS = 20 * 60_000;
const HEALTH_TRIES = 8;
const HEALTH_WAIT_MS = 5000;
const MAX_FORWARDED_LINES = 300;
const MAX_WARNINGS = 8;

class Stopped extends Error {}

export async function runJob(args: {
  db: Database.Database;
  config: DeployConfig;
  job: ClaimedJob;
  workerId: string;
  signal: AbortSignal;
  deps?: PipelineDeps;
  // Also print every event, for the worker's terminal.
  echo?: boolean;
}): Promise<JobOutcome> {
  const { db, config, job, workerId, signal } = args;
  const deps = args.deps ?? realDeps;
  let stage: DeployStage = "plan";

  const log = (level: EventLevel, message: string) => {
    addEvent(db, job.id, stage, level, message);
    if (args.echo) console.log(`[${job.serviceName}] ${stage}: ${message}`);
  };
  const enter = (next: DeployStage) => {
    if (signal.aborted) throw new Stopped("stopped");
    stage = next;
    setStage(db, job.id, next);
  };

  try {
    // 1. Plan
    enter("plan");
    const plan = planFromSnapshot(job.snapshot, job.goal);
    savePlan(db, job.id, plan);
    log("info", `Plan: ${plan.tasks.length} tasks. ${plan.tasks.map((task) => task.title).join(" → ")}.`);
    for (const warning of plan.warnings.slice(0, MAX_WARNINGS)) log("warn", warning);
    if (plan.warnings.length > MAX_WARNINGS) log("warn", `${plan.warnings.length - MAX_WARNINGS} more open questions are in the plan.`);

    // 2. Build
    enter("build");
    const repo = await prepareRepo({
      config,
      projectId: job.projectId,
      jobId: job.id,
      template: job.template,
      snapshot: job.snapshot,
      plan,
      signal,
      log: (level, message) => log(level, message),
    });
    if (signal.aborted) throw new Stopped("stopped");

    // 3. Ship
    enter("ship");
    if (config.dryRun) {
      log("warn", "Dry run: Google Cloud is not called. Nothing is deployed.");
      if (!finishSuccess(db, job.id, workerId, { url: null, revision: null })) return "lost";
      return "succeeded";
    }
    log("info", `Deploying ${job.serviceName} to Cloud Run in ${config.region}. The first build takes a few minutes.`);
    let forwarded = 0;
    let hidden = 0;
    let previous = "";
    const shipped = await deps.ship(
      config,
      { serviceName: job.serviceName, projectId: job.projectId, releaseId: job.id, sourceDir: repo.repoDir },
      {
        signal,
        timeoutMs: SHIP_TIMEOUT_MS,
        onLine: (line) => {
          if (line === previous) return;
          previous = line;
          if (forwarded >= MAX_FORWARDED_LINES) {
            hidden += 1;
            return;
          }
          forwarded += 1;
          log("info", line);
        },
      },
    );
    if (hidden > 0) log("info", `${hidden} more lines of build output were not shown.`);
    if (signal.aborted) throw new Stopped("stopped");
    recordShipped(db, job.id, workerId, shipped);
    log("info", `The service is up at ${shipped.url}${shipped.revision ? ` (revision ${shipped.revision})` : ""}.`);

    // 4. Verify
    enter("verify");
    let healthy = false;
    for (let attempt = 1; attempt <= HEALTH_TRIES && !healthy; attempt += 1) {
      healthy = await deps.health(`${shipped.url}/api/health`, signal);
      if (signal.aborted) throw new Stopped("stopped");
      if (!healthy && attempt < HEALTH_TRIES) {
        log("info", `Waiting for the app to answer (${attempt}/${HEALTH_TRIES})…`);
        await deps.sleep(HEALTH_WAIT_MS, signal);
      }
    }
    if (!healthy) {
      throw new Error(
        `Deployed to ${shipped.url}, but /api/health did not answer after ${HEALTH_TRIES} tries. Open the address to see what happened.`,
      );
    }
    log("info", "The app answers on /api/health.");
    if (!finishSuccess(db, job.id, workerId, { url: shipped.url, revision: shipped.revision || null })) return "lost";
    return "succeeded";
  } catch (error) {
    if (signal.aborted) {
      // "lost": another worker owns the job now, so leave it alone. "shutdown": hand it back to the queue.
      if (signal.reason === "lost") return "lost";
      releaseJob(db, job.id, workerId);
      addEvent(db, job.id, "queued", "warn", "The worker stopped. This deploy will start again.");
      return "released";
    }
    const message = error instanceof Error ? error.message : String(error);
    log("error", message);
    return finishFailure(db, job.id, workerId, message) ? "failed" : "lost";
  }
}
