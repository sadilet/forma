import fs from "node:fs";
import path from "node:path";

export type DeployConfig = {
  // Google Cloud project that runs the apps and region for them.
  gcpProject: string;
  region: string;
  gcloudBin: string;
  // How the service is opened to the public. See docs/deploy.md.
  publicAccess: "allow-unauthenticated" | "no-invoker-iam-check";
  memory: string;
  minInstances: number;
  // SQLite lives inside each container, so more than one instance would mean several different databases.
  maxInstances: number;
  // Skip every call to Google. The rest of the pipeline still runs.
  dryRun: boolean;
  workDir: string;
  templatesDir: string;
  concurrency: number;
  // Who writes the app. "auto" uses the app builder (a model) when an AI key exists and otherwise the
  // ready-made app, if the project has one. See docs/deploy.md.
  builder: "auto" | "agent" | "reference";
  // Where every release is pushed after it is built (a git URL), so projects are not lost with this machine.
  // Null means no push. See docs/deploy.md.
  gitRemote: string | null;
  // Private key for that remote, when it is an SSH address and the usual keys do not apply.
  gitSshKey: string | null;
};

export class ConfigError extends Error {}

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION = /^[a-z]+-[a-z]+[0-9]+$/;
const MEMORY = /^[1-9][0-9]*(Mi|Gi)$/;

function integer(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max}. Got "${raw}".`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): DeployConfig {
  const dryRun = ["1", "true", "yes"].includes((env.DEPLOY_DRY_RUN ?? "").toLowerCase());
  const gcpProject = (env.GCP_PROJECT_ID ?? "").trim();
  const region = (env.GCP_REGION ?? "europe-north1").trim();

  if (!dryRun) {
    if (!gcpProject) {
      throw new ConfigError("GCP_PROJECT_ID is not set. Add it to .env.deploy, or set DEPLOY_DRY_RUN=1 to try the pipeline without Google Cloud.");
    }
    if (!PROJECT_ID.test(gcpProject)) throw new ConfigError(`GCP_PROJECT_ID "${gcpProject}" is not a valid project id.`);
    if (!REGION.test(region)) throw new ConfigError(`GCP_REGION "${region}" is not a valid region, for example europe-north1.`);
  }

  const publicAccess = (env.DEPLOY_PUBLIC_ACCESS ?? "allow-unauthenticated").trim();
  if (publicAccess !== "allow-unauthenticated" && publicAccess !== "no-invoker-iam-check") {
    throw new ConfigError(`DEPLOY_PUBLIC_ACCESS must be allow-unauthenticated or no-invoker-iam-check. Got "${publicAccess}".`);
  }

  const memory = (env.DEPLOY_MEMORY ?? "512Mi").trim();
  if (!MEMORY.test(memory)) throw new ConfigError(`DEPLOY_MEMORY must look like 512Mi or 1Gi. Got "${memory}".`);

  const builder = (env.DEPLOY_BUILDER?.trim() || "auto").toLowerCase();
  if (builder !== "auto" && builder !== "agent" && builder !== "reference") {
    throw new ConfigError(`DEPLOY_BUILDER must be auto, agent or reference. Got "${env.DEPLOY_BUILDER}".`);
  }

  const gitRemote = (env.DEPLOY_GIT_REMOTE ?? "").trim() || null;
  if (gitRemote && (gitRemote.startsWith("-") || /\s/.test(gitRemote))) {
    throw new ConfigError(`DEPLOY_GIT_REMOTE "${gitRemote}" is not a git address. Use something like git@github.com:you/forma-projects.git.`);
  }
  const keyValue = (env.DEPLOY_GIT_SSH_KEY ?? "").trim();
  let gitSshKey: string | null = null;
  if (keyValue) {
    gitSshKey = path.resolve(cwd, keyValue.replace(/^~(?=$|\/)/, env.HOME ?? "~"));
    let mode: number;
    try {
      mode = fs.statSync(gitSshKey).mode;
    } catch {
      throw new ConfigError(`DEPLOY_GIT_SSH_KEY points to ${gitSshKey}, which does not exist.`);
    }
    // ssh refuses a private key that other users can read. A checkout from git gives files mode 644, so
    // tighten it here instead of making every new machine run chmod by hand.
    if (mode & 0o077) {
      try {
        fs.chmodSync(gitSshKey, 0o600);
      } catch {
        throw new ConfigError(`The key ${gitSshKey} can be read by other users, so ssh will refuse it, and it could not be fixed automatically. Run: chmod 600 "${gitSshKey}"`);
      }
    }
  }

  const minInstances = integer(env, "DEPLOY_MIN_INSTANCES", 0, 0, 10);
  const maxInstances = integer(env, "DEPLOY_MAX_INSTANCES", 1, 1, 10);
  if (minInstances > maxInstances) throw new ConfigError("DEPLOY_MIN_INSTANCES cannot be larger than DEPLOY_MAX_INSTANCES.");

  return {
    gcpProject,
    region,
    gcloudBin: (env.GCLOUD_BIN ?? "gcloud").trim() || "gcloud",
    publicAccess,
    memory,
    minInstances,
    maxInstances,
    dryRun,
    workDir: path.resolve(cwd, env.DEPLOY_WORK_DIR ?? path.join("data", "deploy")),
    templatesDir: path.resolve(cwd, "deploy-templates"),
    concurrency: integer(env, "DEPLOY_WORKER_CONCURRENCY", 2, 1, 8),
    builder,
    gitRemote,
    gitSshKey,
  };
}
