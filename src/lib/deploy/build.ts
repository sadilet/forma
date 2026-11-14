import fs from "node:fs";
import path from "node:path";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import type { DeployConfig } from "./config.ts";
import { hasReferenceApp } from "./contract.ts";
import type { BuildPlan, DeployTemplate } from "./contract.ts";
import { isAllowedPath, LIMITS } from "./files.ts";
import type { FileSet } from "./files.ts";
import { writeFiles } from "./generator.ts";
import type { BaseApp, GeneratedApp } from "./generator.ts";
import { runCommand } from "./process.ts";

// Puts the app on disk as a git repo with a Dockerfile, ready for `gcloud run deploy --source`.
// The app comes from one of two places: the app builder (see generator.ts), or a ready-made reference app.

export type PreparedRepo = { repoDir: string; commit: string | null };

function segmentFor(projectId: string): string {
  return projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "project";
}

// Every project gets its own folder under the work directory. The id is cleaned so it can never leave it.
export function repoDirFor(config: DeployConfig, projectId: string): string {
  const root = path.resolve(config.workDir);
  const dir = path.resolve(root, segmentFor(projectId), "repo");
  if (!dir.startsWith(root + path.sep)) throw new Error("The project folder would be outside the work directory.");
  return dir;
}

// Where the app builder starts and checks each version. It is emptied every time, and the repo is only
// touched once a version has passed, so a failed attempt never damages the last good release.
export function scratchDirFor(config: DeployConfig, projectId: string): string {
  const root = path.resolve(config.workDir);
  const dir = path.resolve(root, segmentFor(projectId), "scratch");
  if (!dir.startsWith(root + path.sep)) throw new Error("The project folder would be outside the work directory.");
  return dir;
}

export function runtimeDirFor(config: DeployConfig): string {
  return path.join(config.templatesDir, "runtime");
}

// Reads the last release written by the app builder, if there is one. The reference app is not a base:
// it is not made of the runtime, so there is nothing for the builder to edit.
export function readBaseApp(repoDir: string): BaseApp | null {
  try {
    const meta = path.join(repoDir, ".forma");
    const release = JSON.parse(fs.readFileSync(path.join(meta, "RELEASE.json"), "utf8")) as { builder?: unknown; goal?: unknown };
    if (release.builder !== "agent") return null;
    const snapshot = JSON.parse(fs.readFileSync(path.join(meta, "SNAPSHOT.json"), "utf8")) as Partial<CanvasSnapshot>;
    if (!Array.isArray(snapshot.blocks) || !Array.isArray(snapshot.connections) || !Array.isArray(snapshot.sketches)) return null;

    const files: FileSet = {};
    for (const root of ["app", "public"]) collect(repoDir, root, files);
    if (!("app/index.mjs" in files)) return null;
    return {
      files,
      state: { snapshot: snapshot as CanvasSnapshot, goal: typeof release.goal === "string" ? release.goal : "" },
    };
  } catch {
    return null;
  }
}

function collect(repoDir: string, relative: string, into: FileSet): void {
  const dir = path.join(repoDir, relative);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) collect(repoDir, child, into);
    else if (entry.isFile() && isAllowedPath(child)) {
      const full = path.join(repoDir, child);
      if (fs.statSync(full).size <= LIMITS.fileBytes) into[child] = fs.readFileSync(full, "utf8");
    }
  }
}

export async function prepareRepo(input: {
  config: DeployConfig;
  projectId: string;
  jobId: string;
  template: DeployTemplate;
  snapshot: CanvasSnapshot;
  goal?: string;
  plan: BuildPlan;
  // The app written by the app builder. Without it, the ready-made app for the template is used.
  app?: GeneratedApp;
  model?: string;
  signal?: AbortSignal;
  log: (level: "info" | "warn", message: string) => void;
}): Promise<PreparedRepo> {
  const { config, log, app } = input;

  let sourceDir: string;
  if (app) {
    sourceDir = runtimeDirFor(config);
  } else {
    if (!hasReferenceApp(input.template)) throw new Error(`There is no ready-made app for "${input.template}". Use the app builder (DEPLOY_BUILDER=agent).`);
    sourceDir = path.join(config.templatesDir, input.template);
  }
  if (!fs.existsSync(path.join(sourceDir, "Dockerfile"))) {
    throw new Error(`The "${app ? "runtime" : input.template}" template is missing or has no Dockerfile (${sourceDir}).`);
  }

  const repoDir = repoDirFor(config, input.projectId);
  fs.mkdirSync(repoDir, { recursive: true });
  // Start from a clean folder but keep the git history, so every deploy is a commit on the same repo.
  for (const entry of fs.readdirSync(repoDir)) {
    if (entry !== ".git") fs.rmSync(path.join(repoDir, entry), { recursive: true, force: true });
  }
  fs.cpSync(sourceDir, repoDir, { recursive: true, filter: (source) => path.basename(source) !== "node_modules" });
  if (app) writeFiles(repoDir, app.files);

  const meta = path.join(repoDir, ".forma");
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, "SNAPSHOT.json"), JSON.stringify(input.snapshot, null, 2));
  fs.writeFileSync(path.join(meta, "PLAN.json"), JSON.stringify(input.plan, null, 2));
  fs.writeFileSync(
    path.join(meta, "RELEASE.json"),
    JSON.stringify(
      {
        releaseId: input.jobId,
        projectId: input.projectId,
        template: input.template,
        builder: app ? "agent" : "reference",
        goal: input.goal ?? "",
        ...(app ? { model: input.model ?? null, mode: app.mode, calls: app.calls, summary: app.summary } : {}),
      },
      null,
      2,
    ),
  );
  log("info", `Prepared the app in ${path.relative(process.cwd(), repoDir) || repoDir}.`);

  return { repoDir, commit: await commitRelease(repoDir, input.jobId, app ? "agent" : input.template, input.signal, log) };
}

// History is a bonus. If git is missing or fails, the deploy goes on without a commit.
async function commitRelease(
  repoDir: string,
  jobId: string,
  label: string,
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
    const commit = await git(["commit", "--quiet", "--allow-empty", "-m", `Release ${jobId} (${label})`]);
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
