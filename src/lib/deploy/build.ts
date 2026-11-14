import fs from "node:fs";
import path from "node:path";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import type { DeployConfig } from "./config.ts";
import type { BuildPlan, DeployTemplate } from "./contract.ts";
import { runCommand } from "./process.ts";

// The build step. Today it copies a ready-made reference app for the template. A builder that writes
// the app from the plan with a model plugs in here later: it gets the same folder and must leave the
// same thing behind, a folder with a Dockerfile.

export type PreparedRepo = { repoDir: string; commit: string | null };

// Every project gets its own folder under the work directory. The id is cleaned so it can never leave it.
export function repoDirFor(config: DeployConfig, projectId: string): string {
  const segment = projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "project";
  const root = path.resolve(config.workDir);
  const dir = path.resolve(root, segment, "repo");
  if (!dir.startsWith(root + path.sep)) throw new Error("The project folder would be outside the work directory.");
  return dir;
}

export async function prepareRepo(input: {
  config: DeployConfig;
  projectId: string;
  jobId: string;
  template: DeployTemplate;
  snapshot: CanvasSnapshot;
  plan: BuildPlan;
  signal?: AbortSignal;
  log: (level: "info" | "warn", message: string) => void;
}): Promise<PreparedRepo> {
  const { config, log } = input;
  const templateDir = path.join(config.templatesDir, input.template);
  if (!fs.existsSync(path.join(templateDir, "Dockerfile"))) {
    throw new Error(`The "${input.template}" template is missing or has no Dockerfile (${templateDir}).`);
  }

  const repoDir = repoDirFor(config, input.projectId);
  fs.mkdirSync(repoDir, { recursive: true });
  // Start from a clean folder but keep the git history, so every deploy is a commit on the same repo.
  for (const entry of fs.readdirSync(repoDir)) {
    if (entry !== ".git") fs.rmSync(path.join(repoDir, entry), { recursive: true, force: true });
  }
  fs.cpSync(templateDir, repoDir, { recursive: true, filter: (source) => path.basename(source) !== "node_modules" });

  const meta = path.join(repoDir, ".forma");
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, "SNAPSHOT.json"), JSON.stringify(input.snapshot, null, 2));
  fs.writeFileSync(path.join(meta, "PLAN.json"), JSON.stringify(input.plan, null, 2));
  fs.writeFileSync(
    path.join(meta, "RELEASE.json"),
    JSON.stringify(
      { releaseId: input.jobId, projectId: input.projectId, template: input.template, builder: "reference" },
      null,
      2,
    ),
  );
  log("info", `Prepared the ${input.template} app in ${path.relative(process.cwd(), repoDir) || repoDir}.`);

  return { repoDir, commit: await commitRelease(repoDir, input.jobId, input.template, input.signal, log) };
}

// History is a bonus. If git is missing or fails, the deploy goes on without a commit.
async function commitRelease(
  repoDir: string,
  jobId: string,
  template: string,
  signal: AbortSignal | undefined,
  log: (level: "info" | "warn", message: string) => void,
): Promise<string | null> {
  const env = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Forma",
    GIT_AUTHOR_EMAIL: "forma@localhost",
    GIT_COMMITTER_NAME: "Forma",
    GIT_COMMITTER_EMAIL: "forma@localhost",
  };
  const git = (args: string[]) => runCommand("git", args, { cwd: repoDir, env, signal, timeoutMs: 60_000 });
  try {
    if (!fs.existsSync(path.join(repoDir, ".git"))) {
      const init = await git(["init", "--quiet", "-b", "main"]);
      if (init.code !== 0) throw new Error("git init failed");
    }
    const add = await git(["add", "-A"]);
    if (add.code !== 0) throw new Error("git add failed");
    const commit = await git(["commit", "--quiet", "--allow-empty", "-m", `Release ${jobId} (${template})`]);
    if (commit.code !== 0) throw new Error(commit.tail.slice(-2).join(" ") || "git commit failed");
    const head = await git(["rev-parse", "--short", "HEAD"]);
    const sha = head.stdout.trim();
    if (head.code !== 0 || !sha) throw new Error("git rev-parse failed");
    log("info", `Committed the release as ${sha}.`);
    return sha;
  } catch (error) {
    if (signal?.aborted) throw error;
    log("warn", `Could not commit the release (${error instanceof Error ? error.message : "git failed"}). Continuing without history.`);
    return null;
  }
}
