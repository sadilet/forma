import type { DeployConfig } from "./config.ts";
import { labelValue } from "./names.ts";
import { runCommand } from "./process.ts";
import type { RunOptions, RunResult } from "./process.ts";

// Cloud Run through the gcloud command line tool. `gcloud run deploy --source` uploads the folder,
// builds it with Cloud Build, stores the image, and starts the service in one command.
// The caller must already be signed in: `gcloud auth login`, then `gcloud config set project <id>`.

export type Shipped = { url: string; revision: string };

const CLOUD_ENV = {
  // Never ask a question. The worker has nobody to answer.
  CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
  CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: "true",
};

export function deployArgs(
  config: DeployConfig,
  input: { serviceName: string; projectId: string; releaseId: string; sourceDir: string },
): string[] {
  return [
    "run",
    "deploy",
    input.serviceName,
    "--source",
    input.sourceDir,
    "--project",
    config.gcpProject,
    "--region",
    config.region,
    "--port",
    "8080",
    "--memory",
    config.memory,
    "--min-instances",
    String(config.minInstances),
    "--max-instances",
    String(config.maxInstances),
    "--labels",
    `forma=true,forma-project=${labelValue(input.projectId)}`,
    "--set-env-vars",
    `FORMA_RELEASE=${labelValue(input.releaseId)}`,
    config.publicAccess === "allow-unauthenticated" ? "--allow-unauthenticated" : "--no-invoker-iam-check",
    "--quiet",
  ];
}

export function describeArgs(config: DeployConfig, serviceName: string): string[] {
  return [
    "run",
    "services",
    "describe",
    serviceName,
    "--project",
    config.gcpProject,
    "--region",
    config.region,
    "--format=json",
  ];
}

export function parseService(json: string): Shipped {
  let data: { status?: { url?: unknown; latestReadyRevisionName?: unknown } };
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("gcloud did not return valid JSON for the service.");
  }
  const url = data.status?.url;
  const revision = data.status?.latestReadyRevisionName;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new Error("The service has no public address yet.");
  }
  return { url, revision: typeof revision === "string" ? revision : "" };
}

export async function deployFromSource(
  config: DeployConfig,
  input: { serviceName: string; projectId: string; releaseId: string; sourceDir: string },
  options: RunOptions,
): Promise<Shipped> {
  const result = await runCommand(config.gcloudBin, deployArgs(config, input), {
    ...options,
    env: { ...CLOUD_ENV, ...options.env },
  });
  failOnExit("gcloud run deploy", result);
  return describeService(config, input.serviceName, options);
}

export async function describeService(config: DeployConfig, serviceName: string, options: RunOptions = {}) {
  const result = await runCommand(config.gcloudBin, describeArgs(config, serviceName), {
    signal: options.signal,
    timeoutMs: 60_000,
    env: { ...CLOUD_ENV, ...options.env },
  });
  failOnExit("gcloud run services describe", result);
  return parseService(result.stdout);
}

function failOnExit(what: string, result: RunResult) {
  if (result.code === 0) return;
  const detail = result.tail.slice(-8).join("\n");
  throw new Error(`${what} failed (exit ${result.code ?? "none"}).${detail ? `\n${detail}` : ""}`);
}
