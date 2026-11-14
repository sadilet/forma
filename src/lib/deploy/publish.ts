import fs from "node:fs";
import path from "node:path";
import type { DeployConfig } from "./config.ts";
import { runCommand } from "./process.ts";

// Keeps a project's repo in step with a shared git remote, so the generated code and the canvas it came from
// are not only on this machine's disk. One remote holds every project, one branch per project.
//
//   syncFromRemote  before a build: bring this machine's copy up to date (or restore it on a new machine)
//   publishRelease  after a build: push the new release
//
// Neither ever fails a deploy: a git problem is a warning in the log, and the deploy goes on.

export type PublishResult = { pushed: boolean; branch: string | null; remote: string | null };

const PUSH_TIMEOUT_MS = 90_000;

// The branch for a project. Only letters, digits, dash and underscore, so it is always a valid branch name.
export function branchFor(projectId: string): string {
  return projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "project";
}

// A remote can carry a token (https://user:token@host/...). Log it without that part.
export function displayRemote(remote: string): string {
  return remote.replace(/\/\/[^/@\s]*@/, "//");
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sshCommand(key: string | null): string | null {
  if (!key) return null;
  // git hands this string to a shell, so the path is quoted. accept-new trusts a host the first time and
  // refuses it if its key ever changes. BatchMode keeps ssh from waiting for a password nobody can type.
  return `ssh -i ${quoteForShell(key)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
}

function gitEnv(config: DeployConfig): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
  const ssh = sshCommand(config.gitSshKey);
  if (ssh) env.GIT_SSH_COMMAND = ssh;
  return env;
}

const AUTHOR = {
  GIT_AUTHOR_NAME: "Forma",
  GIT_AUTHOR_EMAIL: "forma@localhost",
  GIT_COMMITTER_NAME: "Forma",
  GIT_COMMITTER_EMAIL: "forma@localhost",
};

type Log = (level: "info" | "warn", message: string) => void;

// Makes the local repo start from what the remote holds for this project.
//   - no local history yet (a new machine, or data/deploy was cleared): restore the remote's last release
//   - the remote is ahead (someone else deployed): move forward to it
//   - the remote is behind or the same: nothing to do
//   - both moved on their own: keep the local copy and say so
export async function syncFromRemote(input: {
  config: DeployConfig;
  repoDir: string;
  projectId: string;
  signal?: AbortSignal;
  log: Log;
}): Promise<"none" | "restored" | "updated" | "current" | "diverged" | "failed"> {
  const { config, log } = input;
  const remote = config.gitRemote;
  if (!remote) return "none";

  const branch = branchFor(input.projectId);
  const env = { ...gitEnv(config), ...AUTHOR };
  const git = (args: string[]) =>
    runCommand("git", args, { cwd: input.repoDir, env, signal: input.signal, timeoutMs: PUSH_TIMEOUT_MS });

  try {
    fs.mkdirSync(input.repoDir, { recursive: true });
    if (!fs.existsSync(path.join(input.repoDir, ".git"))) {
      const init = await git(["init", "--quiet", "-b", "main"]);
      if (init.code !== 0) throw new Error("git init failed");
    }
    const fetch = await git(["fetch", "--quiet", remote, `refs/heads/${branch}`]);
    if (fetch.code !== 0) {
      const detail = fetch.tail.join(" ");
      // A branch that does not exist yet is the normal start of a new project.
      if (/couldn't find remote ref/i.test(detail)) return "none";
      log("warn", `Could not read ${displayRemote(remote)}: ${detail || `git fetch exited with ${fetch.code}`}. Using this machine's copy.`);
      return "failed";
    }

    const hasHistory = (await git(["rev-parse", "-q", "--verify", "HEAD"])).code === 0;
    if (!hasHistory) {
      const restore = await git(["checkout", "--quiet", "-f", "-B", "main", "FETCH_HEAD"]);
      if (restore.code !== 0) throw new Error(restore.tail.slice(-2).join(" ") || "git checkout failed");
      log("info", `Restored the project from ${displayRemote(remote)} (branch ${branch}).`);
      return "restored";
    }
    if ((await git(["merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD"])).code === 0) return "current";
    if ((await git(["merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"])).code === 0) {
      // The local copy is an ancestor, so nothing here is lost by moving forward.
      const forward = await git(["checkout", "--quiet", "-f", "-B", "main", "FETCH_HEAD"]);
      if (forward.code !== 0) throw new Error(forward.tail.slice(-2).join(" ") || "git checkout failed");
      log("info", `Updated this machine's copy from ${displayRemote(remote)}: another deploy was ahead.`);
      return "updated";
    }
    log("warn", `This machine and ${displayRemote(remote)} both have releases the other lacks. Using this machine's copy; the push will not overwrite the remote.`);
    return "diverged";
  } catch (error) {
    if (input.signal?.aborted) throw error;
    log("warn", `Could not sync with ${displayRemote(remote)}: ${error instanceof Error ? error.message : "git failed"}. Using this machine's copy.`);
    return "failed";
  }
}

export async function publishRelease(input: {
  config: DeployConfig;
  repoDir: string;
  projectId: string;
  signal?: AbortSignal;
  log: Log;
}): Promise<PublishResult> {
  const { config, log } = input;
  const remote = config.gitRemote;
  if (!remote) return { pushed: false, branch: null, remote: null };

  const branch = branchFor(input.projectId);
  const env = gitEnv(config);

  try {
    // No --force: a branch that already holds history from another machine is never overwritten.
    const push = await runCommand("git", ["push", remote, `HEAD:refs/heads/${branch}`], {
      cwd: input.repoDir,
      env,
      signal: input.signal,
      timeoutMs: PUSH_TIMEOUT_MS,
    });
    if (push.code === 0) {
      log("info", `Saved the release to ${displayRemote(remote)} (branch ${branch}).`);
      return { pushed: true, branch, remote };
    }
    // git explains a refusal over many lines. Keep the lines that say what happened and drop the hints.
    const lines = push.tail.filter((line) => !/^(To |Everything up-to-date|hint:)/.test(line));
    const detail = lines.slice(0, 3).join(" ");
    const rejected = push.tail.some((line) => /\[rejected\]|non-fast-forward|fetch first/i.test(line));
    log(
      "warn",
      rejected
        ? `The release was not saved: branch ${branch} on ${displayRemote(remote)} already has history from another machine, and it is not overwritten. (${detail})`
        : `The release was not saved to ${displayRemote(remote)}: ${detail || `git push exited with ${push.code}`}`,
    );
  } catch (error) {
    if (input.signal?.aborted) throw error;
    log("warn", `The release was not saved to ${displayRemote(remote)}: ${error instanceof Error ? error.message : "git push failed"}`);
  }
  return { pushed: false, branch, remote };
}
