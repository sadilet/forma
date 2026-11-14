import { randomBytes } from "node:crypto";

// What it takes to run Forma itself on Cloud Run: the settings for the web service and for the deploy worker.
// This file only decides values. scripts/cloud-deploy.ts does the calls to Google Cloud.

export class CloudConfigError extends Error {}

type Env = Record<string, string | undefined>;

export type CloudPlan = {
  project: string;
  region: string;
  instance: string; // project:region:name, as Cloud SQL writes it
  database: string;
  registry: string; // Artifact Registry repository name
  web: { service: string; env: Record<string, string> };
  worker: { service: string; env: Record<string, string> };
  // Set when the session secret did not exist yet and was made up. The caller should save it.
  generatedSessionSecret: string | null;
};

const DEV_SESSION_SECRET = "forma-dev-session-secret";

// Passed to both services when they are set. Anything else stays on this machine.
const AI_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "AI_PROVIDER",
];
const WEB_ONLY = ["CONTEXT_DEV_API_KEY", "LIVEBLOCKS_SECRET_KEY"];
const WORKER_SETTINGS = [
  "DEPLOY_BUILDER",
  "DEPLOY_MODEL",
  "DEPLOY_MAX_OUTPUT_TOKENS",
  "DEPLOY_MEMORY",
  "DEPLOY_PUBLIC_ACCESS",
  "DEPLOY_MIN_INSTANCES",
  "DEPLOY_MAX_INSTANCES",
  "DEPLOY_WORKER_CONCURRENCY",
  "DEPLOY_GIT_REMOTE",
  "DEPLOY_GIT_SSH_KEY",
];

function pick(env: Env, names: string[]) {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) out[name] = value;
  }
  return out;
}

// The address Cloud Run uses for Cloud SQL: a Unix socket that Cloud Run creates when the service is
// started with --add-cloudsql-instances. No IP address, no allow-list and no certificate to manage.
export function cloudDatabaseUrl(instance: string, database: string, password: string, user = "postgres") {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@/${encodeURIComponent(database)}?host=/cloudsql/${instance}`;
}

export function planCloud(env: Env): CloudPlan {
  const project = (env.GCP_PROJECT_ID ?? "").trim();
  if (!project) throw new CloudConfigError("GCP_PROJECT_ID is not set. Add it to .env.deploy.");
  const region = (env.GCP_REGION ?? "europe-north1").trim();
  const password = env.POSTGRES_PASSWORD ?? "";
  if (!password) throw new CloudConfigError("POSTGRES_PASSWORD is not set. Add the password of the Cloud SQL user to .env.deploy.");

  const instance = (env.CLOUD_SQL_INSTANCE ?? "").trim() || `${project}:${region}:forma`;
  if (!/^[^:\s]+:[^:\s]+:[^:\s]+$/.test(instance)) {
    throw new CloudConfigError(`CLOUD_SQL_INSTANCE "${instance}" must look like project:region:instance.`);
  }
  const database = (env.CLOUD_SQL_DATABASE ?? "").trim() || "forma";
  if (!/^[a-z][a-z0-9_]*$/.test(database)) {
    throw new CloudConfigError(`CLOUD_SQL_DATABASE "${database}" may only have lowercase letters, digits and underscores.`);
  }
  const user = (env.CLOUD_SQL_USER ?? "").trim() || "postgres";

  let sessionSecret = (env.SESSION_SECRET ?? "").trim();
  let generatedSessionSecret: string | null = null;
  // The development secret is public (it is in .env.example), so a site that used it could have its login cookies forged.
  if (!sessionSecret || sessionSecret === DEV_SESSION_SECRET) {
    sessionSecret = randomBytes(32).toString("base64url");
    generatedSessionSecret = sessionSecret;
  }

  const databaseUrl = cloudDatabaseUrl(instance, database, password, user);
  const shared = { DATABASE_URL: databaseUrl, ...pick(env, AI_KEYS) };

  return {
    project,
    region,
    instance,
    database,
    registry: (env.CLOUD_REGISTRY ?? "").trim() || "forma",
    web: {
      service: (env.FORMA_WEB_SERVICE ?? "").trim() || "forma",
      env: { ...shared, SESSION_SECRET: sessionSecret, ...pick(env, WEB_ONLY) },
    },
    worker: {
      service: (env.FORMA_WORKER_SERVICE ?? "").trim() || "forma-worker",
      env: {
        ...shared,
        GCP_PROJECT_ID: project,
        GCP_REGION: region,
        ...pick(env, WORKER_SETTINGS),
      },
    },
    generatedSessionSecret,
  };
}

// Cloud Run reads environment files as YAML. JSON is valid YAML, and it needs no quoting rules.
export function envFileContents(env: Record<string, string>) {
  return `${JSON.stringify(env, null, 2)}\n`;
}

export function imageName(plan: CloudPlan, target: "web" | "worker", tag: string) {
  return `${plan.region}-docker.pkg.dev/${plan.project}/${plan.registry}/${target}:${tag}`;
}
