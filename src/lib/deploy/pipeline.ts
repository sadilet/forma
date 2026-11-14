import fs from "node:fs";
import { prepareRepo, readBaseApp, repoDirFor, runtimeDirFor, scratchDirFor } from "./build.ts";
import type { DeployConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { hasReferenceApp } from "./contract.ts";
import type { DeployStage, EventLevel } from "./contract.ts";
import { generateApp } from "./generator.ts";
import type { GeneratedApp } from "./generator.ts";
import { deployFromSource } from "./gcloud.ts";
import type { Shipped } from "./gcloud.ts";
import { AI_SETUP_HINT, loadLlm } from "./llm.ts";
import type { Llm } from "./llm.ts";
import { planFromSnapshot } from "./planner.ts";
import { publishRelease, syncFromRemote } from "./publish.ts";
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
  // The model that writes the app, or null when no AI key is configured.
  llm?: () => Llm | null;
};

export const realDeps: PipelineDeps = {
  ship: deployFromSource,
  llm: () => loadLlm(),
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

type Builder = { kind: "agent"; llm: Llm } | { kind: "reference"; note: string | null };

// Decides who writes the app: the model, or the ready-made reference app.
function chooseBuilder(config: DeployConfig, template: string, llm: Llm | null): Builder {
  const reference = hasReferenceApp(template);
  if (config.builder === "reference") {
    if (!reference) {
      throw new Error('This workspace has no ready-made app, so DEPLOY_BUILDER=reference cannot deploy it. Set DEPLOY_BUILDER=auto or agent.');
    }
    return { kind: "reference", note: null };
  }
  if (llm) return { kind: "agent", llm };
  if (config.builder === "agent" || !reference) {
    throw new Error(`The app builder needs an AI key to write the app from the canvas. ${AI_SETUP_HINT}`);
  }
  return {
    kind: "reference",
    note: `No AI key is set, so the ready-made ${template} app is shipped as it is. Changes on the canvas are NOT applied. ${AI_SETUP_HINT}`,
  };
}

export async function runJob(args: {
  db: Db;
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

  // Events are written one after another, in the order they were logged, without making every caller wait for
  // the database. A failed write is dropped: a missing log line must never fail a deploy.
  let writes: Promise<unknown> = Promise.resolve();
  const log = (level: EventLevel, message: string) => {
    const at = Date.now();
    const where = stage;
    writes = writes.then(() => addEvent(db, job.id, where, level, message, at)).catch(() => {});
    if (args.echo) console.log(`[${job.serviceName}] ${stage}: ${message}`);
  };
  // The page stops reading events when the job is final, so every event must be stored before that.
  const flush = async () => {
    await writes;
  };
  const enter = async (next: DeployStage) => {
    if (signal.aborted) throw new Stopped("stopped");
    stage = next;
    await setStage(db, job.id, next);
  };

  try {
    // 1. Plan
    await enter("plan");
    const plan = planFromSnapshot(job.snapshot, job.goal);
    await savePlan(db, job.id, plan);
    log("info", `Plan: ${plan.tasks.length} tasks. ${plan.tasks.map((task) => task.title).join(" → ")}.`);
    for (const warning of plan.warnings.slice(0, MAX_WARNINGS)) log("warn", warning);
    if (plan.warnings.length > MAX_WARNINGS) log("warn", `${plan.warnings.length - MAX_WARNINGS} more open questions are in the plan.`);

    // 2. Build
    await enter("build");
    // Start from what the shared remote holds for this project, if one is set up. This is what lets a
    // new machine (or a cleared data/deploy) carry on from the last release instead of starting over.
    await syncFromRemote({ config, repoDir: repoDirFor(config, job.projectId), projectId: job.projectId, signal, log: (level, message) => log(level, message) });
    if (signal.aborted) throw new Stopped("stopped");
    const builder = chooseBuilder(config, job.template, (deps.llm ?? realDeps.llm!)());
    let app: GeneratedApp | undefined;
    if (builder.kind === "agent") {
      const scratchDir = scratchDirFor(config, job.projectId);
      try {
        app = await generateApp({
          llm: builder.llm,
          kitDir: runtimeDirFor(config),
          scratchDir,
          goal: job.goal,
          snapshot: job.snapshot,
          plan,
          base: readBaseApp(repoDirFor(config, job.projectId)),
          signal,
          log: (level, message) => log(level, message),
        });
      } finally {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
    } else if (builder.note) {
      log("warn", builder.note);
    }
    if (signal.aborted) throw new Stopped("stopped");
    const repo = await prepareRepo({
      config,
      projectId: job.projectId,
      jobId: job.id,
      template: job.template,
      snapshot: job.snapshot,
      goal: job.goal,
      plan,
      app,
      model: builder.kind === "agent" ? builder.llm.model : undefined,
      signal,
      log: (level, message) => log(level, message),
    });
    if (signal.aborted) throw new Stopped("stopped");
    if (repo.commit) {
      await publishRelease({ config, repoDir: repo.repoDir, projectId: job.projectId, signal, log: (level, message) => log(level, message) });
      if (signal.aborted) throw new Stopped("stopped");
    }

    // 3. Ship
    await enter("ship");
    if (config.dryRun) {
      log("warn", "Dry run: Google Cloud is not called. Nothing is deployed.");
      await flush();
      if (!(await finishSuccess(db, job.id, workerId, { url: null, revision: null }))) return "lost";
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
    await recordShipped(db, job.id, workerId, shipped);
    log("info", `The service is up at ${shipped.url}${shipped.revision ? ` (revision ${shipped.revision})` : ""}.`);

    // 4. Verify
    await enter("verify");
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
    await flush();
    if (!(await finishSuccess(db, job.id, workerId, { url: shipped.url, revision: shipped.revision || null }))) return "lost";
    return "succeeded";
  } catch (error) {
    if (signal.aborted) {
      // "lost": another worker owns the job now, so leave it alone. "shutdown": hand it back to the queue.
      if (signal.reason === "lost") return "lost";
      await flush();
      await releaseJob(db, job.id, workerId);
      await addEvent(db, job.id, "queued", "warn", "The worker stopped. This deploy will start again.");
      return "released";
    }
    const message = error instanceof Error ? error.message : String(error);
    log("error", message);
    await flush();
    return (await finishFailure(db, job.id, workerId, message)) ? "failed" : "lost";
  }
}
