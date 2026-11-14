import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { DeployConfig } from "./config.ts";
import { HEARTBEAT_MS } from "./contract.ts";
import { realDeps, runJob } from "./pipeline.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { claimJob, heartbeat, requeueStale } from "./queue.ts";

// Takes jobs from the queue and runs them, up to `concurrency` at a time, until the signal aborts.
// Run it as its own process (npm run deploy:worker). The web app only puts jobs in the queue.

export async function runWorker(options: {
  db: Database.Database;
  config: DeployConfig;
  signal: AbortSignal;
  workerId?: string;
  pollMs?: number;
  deps?: PipelineDeps;
  echo?: boolean;
}): Promise<void> {
  const { db, config, signal } = options;
  const deps = options.deps ?? realDeps;
  const workerId = options.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const pollMs = options.pollMs ?? 2000;
  const active = new Map<string, Promise<unknown>>();
  const controllers = new Map<string, AbortController>();

  const start = (job: NonNullable<ReturnType<typeof claimJob>>) => {
    const controller = new AbortController();
    controllers.set(job.id, controller);
    // If the heartbeat fails, the queue gave this job to someone else. Stop working on it.
    const beat = setInterval(() => {
      if (!heartbeat(db, job.id, workerId)) controller.abort("lost");
    }, HEARTBEAT_MS);
    if (options.echo) console.log(`[${workerId}] picked up ${job.serviceName} (${job.id})`);
    const running = runJob({ db, config, job, workerId, signal: controller.signal, deps, echo: options.echo })
      .then((outcome) => {
        if (options.echo) console.log(`[${workerId}] ${job.serviceName}: ${outcome}`);
      })
      .catch((error) => console.error(`[${workerId}] ${job.serviceName} crashed:`, error))
      .finally(() => {
        clearInterval(beat);
        controllers.delete(job.id);
        active.delete(job.id);
      });
    active.set(job.id, running);
  };

  while (!signal.aborted) {
    try {
      requeueStale(db);
      while (active.size < config.concurrency) {
        const job = claimJob(db, workerId);
        if (!job) break;
        start(job);
      }
    } catch (error) {
      // A locked database or similar. Try again on the next round instead of stopping the worker.
      console.error(`[${workerId}] queue error:`, error);
    }
    await deps.sleep(pollMs, signal);
  }

  for (const controller of controllers.values()) controller.abort("shutdown");
  await Promise.allSettled([...active.values()]);
}
