// Starts the deploy worker: npm run deploy:worker
// It reads .env.local and .env.deploy, so it uses the same database as the web app (DATABASE_URL).

import http from "node:http";
import { describeDatabase } from "../src/lib/db/connection.ts";
import { ConfigError, loadConfig } from "../src/lib/deploy/config.ts";
import { getDeployDb } from "../src/lib/deploy/db.ts";
import { AI_SETUP_HINT, loadLlm } from "../src/lib/deploy/llm.ts";
import { displayRemote } from "../src/lib/deploy/publish.ts";
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

const llm = loadLlm();
if (config.builder === "reference") {
  console.log("Builder: ready-made apps only (DEPLOY_BUILDER=reference). Canvas edits are not applied.");
} else if (llm) {
  console.log(`Builder: the app is written from the canvas by ${llm.provider} (${llm.model}).`);
} else if (config.builder === "agent") {
  console.warn(`Builder: no AI key, so deploys will fail. ${AI_SETUP_HINT}`);
} else {
  console.warn(`Builder: no AI key. Only SlotGuard can deploy, as its ready-made app, and canvas edits are not applied. ${AI_SETUP_HINT}`);
}

if (config.gitRemote) {
  console.log(`Saving projects to ${displayRemote(config.gitRemote)}${config.gitSshKey ? " with the key from DEPLOY_GIT_SSH_KEY" : ""}.`);
} else {
  console.log("Projects are kept on this machine only. Set DEPLOY_GIT_REMOTE to save them to git (see docs/deploy.md).");
}

console.log(`Queue: ${describeDatabase()}.`);

// Cloud Run only keeps a container that listens on $PORT. On a laptop PORT is not set and this does nothing.
if (process.env.PORT) {
  http
    .createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("forma deploy worker\n");
    })
    .listen(Number(process.env.PORT), () => console.log(`Answering health checks on port ${process.env.PORT}.`));
}

await runWorker({ db: await getDeployDb(), config, signal: controller.signal, echo: true });
console.log("Deploy worker stopped.");
// The database connections would keep the process alive otherwise.
process.exit(0);
