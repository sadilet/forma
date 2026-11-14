import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { repoDirFor } from "./build.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { ensureDeployTables } from "./db.ts";
import { runJob } from "./pipeline.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { publishRelease, syncFromRemote, branchFor, displayRemote, sshCommand } from "./publish.ts";
import { claimJob, enqueueJob, listEvents } from "./queue.ts";
import { answerOf, appFiles, fakeLlm } from "./test-app.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-publish-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@localhost",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@localhost",
};
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, env, encoding: "utf8" });

// Some locked-down environments do not let git create a repository. These tests are skipped there.
const canGit = (() => {
  const dir = fs.mkdtempSync(path.join(tmp, "probe-"));
  return git(dir, "init", "--quiet").status === 0;
})();
const skip = canGit ? false : "git cannot create a repository in this environment";

function remote() {
  const dir = fs.mkdtempSync(path.join(tmp, "remote-")) + ".git";
  assert.equal(git(tmp, "init", "--bare", "--quiet", "-b", "main", dir).status, 0);
  return dir;
}

function configFor(gitRemote: string | null, extra: Record<string, string> = {}) {
  return loadConfig(
    { GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_WORK_DIR: fs.mkdtempSync(path.join(tmp, "work-")), ...(gitRemote ? { DEPLOY_GIT_REMOTE: gitRemote } : {}), ...extra },
    process.cwd(),
  );
}

// A project repo with one commit per entry in `commits`, each writing the files it lists.
function repo(commits: Record<string, string>[], dir = fs.mkdtempSync(path.join(tmp, "repo-"))) {
  assert.equal(git(dir, "init", "--quiet", "-b", "main").status, 0);
  commits.forEach((files, index) => {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    git(dir, "add", "-A");
    assert.equal(git(dir, "commit", "--quiet", "-m", `release ${index + 1}`).status, 0);
  });
  return dir;
}

const head = (dir: string, ref = "HEAD") => git(dir, "rev-parse", ref).stdout.trim();
const logger = () => {
  const lines: string[] = [];
  return { lines, log: (level: string, message: string) => lines.push(`${level}: ${message}`) };
};

// ---- Pure helpers ------------------------------------------------------------------------------------------------

test("a project branch is always a safe branch name", () => {
  assert.equal(branchFor("project-slotguard"), "project-slotguard");
  assert.equal(branchFor("a/b c..d"), "a_b_c__d");
  assert.equal(branchFor(""), "project");
  assert.equal(branchFor("x".repeat(200)).length, 80);
});

test("a token in the remote address is never logged", () => {
  assert.equal(displayRemote("https://sadilet:ghp_secret@github.com/sadilet/forma-examples.git"), "https://github.com/sadilet/forma-examples.git");
  assert.equal(displayRemote("git@github.com:sadilet/forma-examples.git"), "git@github.com:sadilet/forma-examples.git");
});

test("the ssh command quotes the key path, whatever is in it", () => {
  assert.equal(sshCommand(null), null);
  const command = sshCommand("/Users/a b/it's key")!;
  assert.match(command, /^ssh -i '\/Users\/a b\/it'\\''s key' -o IdentitiesOnly=yes /);
  assert.match(command, /StrictHostKeyChecking=accept-new/);
  assert.match(command, /BatchMode=yes/);
});

test("the remote and the key are checked when the worker starts", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "keys-"));
  const key = path.join(dir, "key");
  fs.writeFileSync(key, "not a real key");

  fs.chmodSync(key, 0o644);
  // A key from a git checkout is 644: the config tightens it instead of failing.
  assert.equal(configFor("git@github.com:a/b.git", { DEPLOY_GIT_SSH_KEY: key }).gitSshKey, key);
  assert.equal(fs.statSync(key).mode & 0o077, 0);
  assert.equal(configFor("git@github.com:a/b.git", { DEPLOY_GIT_SSH_KEY: key }).gitSshKey, key);
  assert.throws(() => configFor(null, { DEPLOY_GIT_SSH_KEY: path.join(dir, "missing") }), /does not exist/);
  assert.throws(() => configFor("--upload-pack=evil"), ConfigError);
  assert.throws(() => configFor("git@github.com:a/b.git extra"), ConfigError);
  assert.equal(configFor(null).gitRemote, null);
  assert.equal(configFor("  ").gitRemote, null);
});

// ---- Pushing ---------------------------------------------------------------------------------------------------

test("without a remote nothing is pushed and nothing is said", async () => {
  const { lines, log } = logger();
  const result = await publishRelease({ config: configFor(null), repoDir: tmp, projectId: "p", log });
  assert.deepEqual(result, { pushed: false, branch: null, remote: null });
  assert.deepEqual(lines, []);
});

test("a release is pushed to the project's branch, and the next one follows it", { skip }, async () => {
  const bare = remote();
  const dir = repo([{ "app/index.mjs": "one" }]);
  const config = configFor(bare);
  const { lines, log } = logger();

  const first = await publishRelease({ config, repoDir: dir, projectId: "project-slotguard", log });
  assert.equal(first.pushed, true);
  assert.equal(first.branch, "project-slotguard");
  assert.equal(head(bare, "refs/heads/project-slotguard"), head(dir));
  assert.ok(lines.some((line) => /Saved the release to .* \(branch project-slotguard\)/.test(line)));

  fs.writeFileSync(path.join(dir, "app", "index.mjs"), "two");
  git(dir, "commit", "--quiet", "-am", "release 2");
  const second = await publishRelease({ config, repoDir: dir, projectId: "project-slotguard", log });
  assert.equal(second.pushed, true);
  assert.equal(head(bare, "refs/heads/project-slotguard"), head(dir));
  assert.equal(git(bare, "rev-list", "--count", "refs/heads/project-slotguard").stdout.trim(), "2");
});

test("two projects share a remote and keep to their own branches", { skip }, async () => {
  const bare = remote();
  const config = configFor(bare);
  const a = repo([{ "a.txt": "a" }]);
  const b = repo([{ "b.txt": "b" }]);
  await publishRelease({ config, repoDir: a, projectId: "project-a", log: () => undefined });
  await publishRelease({ config, repoDir: b, projectId: "project-b", log: () => undefined });
  assert.equal(head(bare, "refs/heads/project-a"), head(a));
  assert.equal(head(bare, "refs/heads/project-b"), head(b));
});

test("history from another machine is never overwritten, and the deploy is not stopped", { skip }, async () => {
  const bare = remote();
  const config = configFor(bare);
  const mine = repo([{ "x.txt": "mine" }]);
  const theirs = repo([{ "x.txt": "theirs" }]);
  await publishRelease({ config, repoDir: theirs, projectId: "project-p", log: () => undefined });

  const { lines, log } = logger();
  const result = await publishRelease({ config, repoDir: mine, projectId: "project-p", log });
  assert.equal(result.pushed, false);
  assert.equal(head(bare, "refs/heads/project-p"), head(theirs), "the remote kept the other machine's release");
  assert.ok(lines.some((line) => /^warn: .*already has history from another machine/.test(line)));
});

test("a remote that cannot be reached is a warning, not an error", { skip }, async () => {
  const dir = repo([{ "x.txt": "x" }]);
  const { lines, log } = logger();
  const result = await publishRelease({ config: configFor(path.join(tmp, "no-such-remote.git")), repoDir: dir, projectId: "p", log });
  assert.equal(result.pushed, false);
  assert.ok(lines.some((line) => /^warn: The release was not saved to/.test(line)));
});

// ---- Syncing before a build -------------------------------------------------------------------------------------

test("a project with no remote branch yet just starts", { skip }, async () => {
  const bare = remote();
  const dir = path.join(tmp, "fresh-project");
  const { lines, log } = logger();
  assert.equal(await syncFromRemote({ config: configFor(bare), repoDir: dir, projectId: "p", log }), "none");
  assert.deepEqual(lines, []);
  assert.ok(fs.existsSync(path.join(dir, ".git")));
});

test("a new machine restores the project from the remote", { skip }, async () => {
  const bare = remote();
  const config = configFor(bare);
  const original = repo([{ "app/index.mjs": "export default 1;\n", ".forma/RELEASE.json": "{}" }]);
  await publishRelease({ config, repoDir: original, projectId: "p", log: () => undefined });

  const dir = path.join(tmp, "new-machine");
  const { lines, log } = logger();
  assert.equal(await syncFromRemote({ config, repoDir: dir, projectId: "p", log }), "restored");
  assert.equal(fs.readFileSync(path.join(dir, "app", "index.mjs"), "utf8"), "export default 1;\n");
  assert.equal(head(dir), head(original));
  assert.ok(lines.some((line) => /Restored the project from/.test(line)));
});

test("a machine that is behind moves forward, and one that is level or ahead is left alone", { skip }, async () => {
  const bare = remote();
  const config = configFor(bare);
  const dir = repo([{ "v.txt": "1" }]);
  await publishRelease({ config, repoDir: dir, projectId: "p", log: () => undefined });
  const behind = path.join(tmp, "behind");
  await syncFromRemote({ config, repoDir: behind, projectId: "p", log: () => undefined });

  assert.equal(await syncFromRemote({ config, repoDir: behind, projectId: "p", log: () => undefined }), "current");

  fs.writeFileSync(path.join(dir, "v.txt"), "2");
  git(dir, "commit", "--quiet", "-am", "release 2");
  await publishRelease({ config, repoDir: dir, projectId: "p", log: () => undefined });

  const { lines, log } = logger();
  assert.equal(await syncFromRemote({ config, repoDir: behind, projectId: "p", log }), "updated");
  assert.equal(fs.readFileSync(path.join(behind, "v.txt"), "utf8"), "2");
  assert.ok(lines.some((line) => /another deploy was ahead/.test(line)));

  fs.writeFileSync(path.join(behind, "v.txt"), "3");
  git(behind, "commit", "--quiet", "-am", "local release");
  assert.equal(await syncFromRemote({ config, repoDir: behind, projectId: "p", log: () => undefined }), "current", "ahead of the remote is fine");
  assert.equal(fs.readFileSync(path.join(behind, "v.txt"), "utf8"), "3");
});

test("when both sides have moved on, the local copy is kept and the log says so", { skip }, async () => {
  const bare = remote();
  const config = configFor(bare);
  const dir = repo([{ "v.txt": "1" }]);
  await publishRelease({ config, repoDir: dir, projectId: "p", log: () => undefined });
  const other = path.join(tmp, "other");
  await syncFromRemote({ config, repoDir: other, projectId: "p", log: () => undefined });

  fs.writeFileSync(path.join(dir, "v.txt"), "from dir");
  git(dir, "commit", "--quiet", "-am", "dir release");
  await publishRelease({ config, repoDir: dir, projectId: "p", log: () => undefined });
  fs.writeFileSync(path.join(other, "v.txt"), "from other");
  git(other, "commit", "--quiet", "-am", "other release");

  const { lines, log } = logger();
  assert.equal(await syncFromRemote({ config, repoDir: other, projectId: "p", log }), "diverged");
  assert.equal(fs.readFileSync(path.join(other, "v.txt"), "utf8"), "from other");
  assert.ok(lines.some((line) => /^warn: .*both have releases the other lacks/.test(line)));
});

test("a remote that cannot be read leaves the machine's own copy in use", { skip }, async () => {
  const dir = repo([{ "v.txt": "1" }]);
  const { lines, log } = logger();
  assert.equal(await syncFromRemote({ config: configFor(path.join(tmp, "gone.git")), repoDir: dir, projectId: "p", log }), "failed");
  assert.ok(lines.some((line) => /^warn: Could not read/.test(line)));
  assert.equal(fs.readFileSync(path.join(dir, "v.txt"), "utf8"), "1");
});

// ---- Inside a deploy ---------------------------------------------------------------------------------------------

const canvas: CanvasSnapshot = {
  blocks: [{ id: "shape:a", kind: "screen", title: "Home", description: "The first screen." }],
  connections: [],
  sketches: [],
};

test("a deploy saves the release, and a second machine carries on from it without asking the model again", { skip }, async () => {
  const bare = remote();
  const deps = (llm: ReturnType<typeof fakeLlm>): PipelineDeps => ({
    ship: async () => {
      throw new Error("not called in a dry run");
    },
    health: async () => true,
    sleep: async () => undefined,
    llm: () => llm,
  });
  const deploy = async (llm: ReturnType<typeof fakeLlm>) => {
    const db = new Database(":memory:");
    ensureDeployTables(db);
    const config = configFor(bare, { DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "agent" });
    enqueueJob(db, { projectId: "project-taskflow", requestedBy: "u", template: "taskflow", serviceName: "forma-project-taskflow", snapshot: canvas, goal: "A tiny product." });
    const job = claimJob(db, "w1")!;
    const outcome = await runJob({ db, config, job, workerId: "w1", signal: new AbortController().signal, deps: deps(llm) });
    return { outcome, config, log: listEvents(db, job.id).map((event) => event.message) };
  };

  const first = fakeLlm([answerOf(appFiles("Home"))]);
  const one = await deploy(first);
  assert.equal(one.outcome, "succeeded");
  assert.equal(first.calls.length, 1);
  assert.ok(one.log.some((line) => /Saved the release to .* \(branch project-taskflow\)/.test(line)));
  assert.ok(git(bare, "rev-parse", "refs/heads/project-taskflow").status === 0);

  // A different machine: its own work folder, nothing on disk, the same remote.
  const second = fakeLlm([answerOf(appFiles("Different"))]);
  const two = await deploy(second);
  assert.equal(two.outcome, "succeeded");
  assert.equal(second.calls.length, 0, "the app was restored from the remote and the canvas did not change");
  assert.ok(two.log.some((line) => /Restored the project from/.test(line)));
  assert.ok(two.log.some((line) => /has not changed/.test(line)));
  assert.match(fs.readFileSync(path.join(repoDirFor(two.config, "project-taskflow"), "app", "index.mjs"), "utf8"), /Home/);
  assert.equal(git(bare, "rev-list", "--count", "refs/heads/project-taskflow").stdout.trim(), "2", "the second machine added a commit on top");
});

test("a push that fails does not fail the deploy", { skip }, async () => {
  const db = new Database(":memory:");
  ensureDeployTables(db);
  const config = configFor(path.join(tmp, "never.git"), { DEPLOY_DRY_RUN: "1", DEPLOY_BUILDER: "agent" });
  enqueueJob(db, { projectId: "project-x", requestedBy: "u", template: "blank", serviceName: "forma-project-x", snapshot: canvas, goal: "" });
  const job = claimJob(db, "w1")!;
  const outcome = await runJob({
    db,
    config,
    job,
    workerId: "w1",
    signal: new AbortController().signal,
    deps: { ship: async () => ({ url: "", revision: "" }), health: async () => true, sleep: async () => undefined, llm: () => fakeLlm([answerOf(appFiles())]) },
  });
  assert.equal(outcome, "succeeded");
  const warnings = listEvents(db, job.id).filter((event) => event.level === "warn").map((event) => event.message);
  assert.ok(warnings.some((message) => /Could not read/.test(message)));
  assert.ok(warnings.some((message) => /was not saved to/.test(message)));
});
