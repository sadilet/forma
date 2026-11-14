// Puts Forma itself on Cloud Run: the web app, the deploy worker, and the voice relay. See docs/cloud.md.
//
//   npm run cloud:deploy              voice, then web (with VOICE_RELAY_URL filled in), then worker
//   npm run cloud:deploy -- voice     only the Gemini Live relay; writes VOICE_RELAY_URL into .env.cloud
//   npm run cloud:deploy -- web       only the web app
//   npm run cloud:deploy -- worker    only the deploy worker
//
// It uses your own `gcloud auth login` and builds the images in Cloud Build, so neither Docker nor a key file is needed.
// Settings come from .env.cloud, .env.local and .env.deploy (the first one that sets a name wins).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CloudConfigError,
  envFileContents,
  imageName,
  planCloud,
  voiceRelayPublicUrl,
  type CloudTarget,
} from "../src/lib/deploy/cloud.ts";
import type { CloudPlan } from "../src/lib/deploy/cloud.ts";

for (const file of [".env.cloud", ".env.local", ".env.deploy"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const gcloudBin = process.env.GCLOUD_BIN?.trim() || "gcloud";

const targets = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
for (const target of targets) {
  if (target !== "web" && target !== "worker" && target !== "voice" && target !== "all") {
    fail(`Unknown target "${target}". Use web, worker, voice or all.`);
  }
}
const wantAll = targets.length === 0 || targets.includes("all");
const wantVoice = wantAll || targets.includes("voice");
const wantWeb = wantAll || targets.includes("web");
const wantWorker = wantAll || targets.includes("worker");

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`\n==> ${message}`);
}

type RunResult = { code: number; out: string };

// `capture` keeps the output instead of showing it.
function gcloud(args: string[], options: { capture?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gcloudBin, args, { stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", (chunk) => (out += chunk));
    child.on("error", (error) =>
      reject(new Error(`Could not start gcloud (${gcloudBin}): ${error.message}. Set GCLOUD_BIN in .env.deploy to its full path.`)),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

async function gcloudOrFail(args: string[], what: string) {
  const result = await gcloud(args);
  if (result.code !== 0) fail(`${what} failed (gcloud exited with ${result.code}). The messages above say why.`);
}

let plan: CloudPlan;
try {
  plan = planCloud(process.env);
} catch (error) {
  if (error instanceof CloudConfigError) fail(error.message);
  throw error;
}

if (plan.generatedSessionSecret) {
  // The login cookie is signed with this. It must stay the same between deploys, or everybody is signed out each time.
  fs.appendFileSync(".env.cloud", `${fs.existsSync(".env.cloud") ? "\n" : ""}# Signs the login cookie of the deployed Forma. Made by npm run cloud:deploy.\nSESSION_SECRET=${plan.generatedSessionSecret}\n`, { mode: 0o600 });
  console.log("Made a session secret for the deployed app and saved it in .env.cloud.");
}

const projectArgs = ["--project", plan.project];
const regionArgs = ["--region", plan.region];

function rememberVoiceRelayUrl(wssUrl: string) {
  plan.web.env.VOICE_RELAY_URL = wssUrl;
  process.env.VOICE_RELAY_URL = wssUrl;
  const file = ".env.cloud";
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (/^VOICE_RELAY_URL=/m.test(existing)) {
    fs.writeFileSync(file, existing.replace(/^VOICE_RELAY_URL=.*$/m, `VOICE_RELAY_URL=${wssUrl}`), { mode: 0o600 });
  } else {
    fs.appendFileSync(
      file,
      `${existing.endsWith("\n") || !existing ? "" : "\n"}# Public WebSocket URL of forma-voice. Filled in by npm run cloud:deploy.\nVOICE_RELAY_URL=${wssUrl}\n`,
      { mode: 0o600 },
    );
  }
}

async function serviceHttpsUrl(serviceName: string) {
  const url = await gcloud(
    ["run", "services", "describe", serviceName, "--format=value(status.url)", ...regionArgs, ...projectArgs],
    { capture: true },
  );
  if (url.code !== 0) return "";
  return url.out.trim();
}

async function main() {
  console.log(`Project ${plan.project}, region ${plan.region}, database ${plan.database} on ${plan.instance}.`);

  step("Checking that you are signed in to Google Cloud");
  const account = await gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], { capture: true });
  if (account.code !== 0 || !account.out.trim()) fail("gcloud has no signed-in account. Run: gcloud auth login");
  console.log(`Signed in as ${account.out.trim()}.`);

  step("Turning on the Google Cloud services that are needed");
  await gcloudOrFail(
    ["services", "enable", "run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "sqladmin.googleapis.com", ...projectArgs],
    "Turning on the services",
  );

  if (wantWeb || wantWorker) {
    step(`Making sure the database "${plan.database}" exists`);
    const instanceName = plan.instance.split(":")[2];
    const databases = await gcloud(["sql", "databases", "list", "--instance", instanceName, "--format=value(name)", ...projectArgs], { capture: true });
    if (databases.code !== 0) fail(`Could not read the databases of ${plan.instance}:\n${databases.out}`);
    if (databases.out.split("\n").map((line) => line.trim()).includes(plan.database)) {
      console.log("It exists.");
    } else {
      await gcloudOrFail(["sql", "databases", "create", plan.database, "--instance", instanceName, ...projectArgs], "Creating the database");
    }
  }

  step("Making sure the image repository exists");
  const repo = await gcloud(["artifacts", "repositories", "describe", plan.registry, "--location", plan.region, ...projectArgs], { capture: true });
  if (repo.code !== 0) {
    await gcloudOrFail(
      ["artifacts", "repositories", "create", plan.registry, "--repository-format=docker", "--location", plan.region, ...projectArgs],
      "Creating the image repository",
    );
  } else {
    console.log("It exists.");
  }

  const tag = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  // Voice first so its public URL can be handed to the web app as VOICE_RELAY_URL.
  if (wantVoice) {
    if (!plan.voice.env.GEMINI_API_KEY && !plan.voice.env.GOOGLE_API_KEY) {
      fail("Voice relay needs GEMINI_API_KEY (or GOOGLE_API_KEY). Add it to .env.local and run again.");
    }
    await ship("voice", tag);
    const httpsUrl = await serviceHttpsUrl(plan.voice.service);
    if (!httpsUrl) fail(`Could not read the URL of ${plan.voice.service} after deploy.`);
    const wssUrl = voiceRelayPublicUrl(httpsUrl);
    rememberVoiceRelayUrl(wssUrl);
    console.log(`Saved VOICE_RELAY_URL=${wssUrl} in .env.cloud for the web app.`);
  } else if (wantWeb && !plan.web.env.VOICE_RELAY_URL) {
    // Web-only redeploy: reuse an already-running relay if one exists.
    const httpsUrl = await serviceHttpsUrl(plan.voice.service);
    if (httpsUrl) {
      const wssUrl = voiceRelayPublicUrl(httpsUrl);
      rememberVoiceRelayUrl(wssUrl);
      console.log(`Using existing voice relay at ${wssUrl}.`);
    } else {
      console.log("No VOICE_RELAY_URL yet. Voice will not work until you run: npm run cloud:deploy -- voice");
    }
  }

  if (wantWeb) await ship("web", tag);
  if (wantWorker) await ship("worker", tag);
  console.log("\nDone.");
}

async function ship(target: CloudTarget, tag: string) {
  const service = plan[target];
  const image = imageName(plan, target, tag);

  step(`Building the ${target} image in Cloud Build (a few minutes)`);
  await gcloudOrFail(
    [
      "builds",
      "submit",
      "--config",
      "scripts/cloud-build.yaml",
      "--substitutions",
      `_TARGET=${target},_IMAGE=${image},_TLDRAW=${process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY ?? ""}`,
      ...projectArgs,
      ".",
    ],
    `Building the ${target} image`,
  );

  // The settings go in a file with owner-only access, not on the command line where `ps` would show them.
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "forma-cloud-")), "env.yaml");
  fs.writeFileSync(envFile, envFileContents(service.env), { mode: 0o600 });
  try {
    step(`Starting the ${target} service "${service.service}"`);
    const common = [
      "run",
      "deploy",
      service.service,
      "--image",
      image,
      "--env-vars-file",
      envFile,
      "--port",
      "8080",
      "--quiet",
      ...regionArgs,
      ...projectArgs,
    ];
    const web = [
      "--allow-unauthenticated",
      "--add-cloudsql-instances",
      plan.instance,
      "--memory",
      "1Gi",
      "--cpu",
      "1",
      "--min-instances",
      "0",
      "--max-instances",
      "5",
      "--concurrency",
      "40",
    ];
    // The worker has to keep running between requests, so it gets its CPU all the time and exactly one instance.
    const worker = [
      "--no-allow-unauthenticated",
      "--add-cloudsql-instances",
      plan.instance,
      "--no-cpu-throttling",
      "--memory",
      "2Gi",
      "--cpu",
      "2",
      "--min-instances",
      "1",
      "--max-instances",
      "1",
      "--timeout",
      "3600",
    ];
    // Long-lived WebSockets; ticket auth, no Cloud SQL.
    const voice = [
      "--allow-unauthenticated",
      "--memory",
      "512Mi",
      "--cpu",
      "1",
      "--min-instances",
      "0",
      "--max-instances",
      "5",
      "--concurrency",
      "40",
      "--timeout",
      "3600",
      "--session-affinity",
    ];
    const extra = target === "web" ? web : target === "worker" ? worker : voice;
    await gcloudOrFail([...common, ...extra], `Starting the ${target} service`);
  } finally {
    fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
  }

  const url = await serviceHttpsUrl(service.service);
  console.log(`\n${target}: ${url}`);
  if (target === "web") {
    const answer = await fetch(url).then((res) => res.status).catch(() => 0);
    console.log(answer >= 200 && answer < 400 ? `The app answers (HTTP ${answer}).` : `The app did not answer yet (HTTP ${answer}). Check: gcloud run services logs read ${service.service} --region ${plan.region}`);
  }
  if (target === "voice") {
    const answer = await fetch(url).then((res) => res.status).catch(() => 0);
    console.log(answer === 200 ? `The relay answers (HTTP ${answer}).` : `The relay did not answer yet (HTTP ${answer}).`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
