// Starts the deploy worker: npm run deploy:worker
// It reads .env.local and .env.deploy, so it uses the same database as the web app.

import { ConfigError, loadConfig } from "../src/lib/deploy/config.ts";
import { getDeployDb } from "../src/lib/deploy/db.ts";
import { runWorker } from "../src/lib/deploy/worker.ts";

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Deploy worker cannot start.\n${error.message}`);
    process.exit(1);
  }
  throw error;
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`Got ${signal}. Handing running deploys back to the queue…`);
    controller.abort("shutdown");
  });
}

console.log(
  config.dryRun
    ? "Deploy worker started in DRY RUN mode. Google Cloud is not called."
    : `Deploy worker started. Project ${config.gcpProject}, region ${config.region}.`,
);

await runWorker({ db: getDeployDb(), config, signal: controller.signal, echo: true });
console.log("Deploy worker stopped.");
