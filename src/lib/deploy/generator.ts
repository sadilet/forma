import fs from "node:fs";
import path from "node:path";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import type { BuildPlan, EventLevel } from "./contract.ts";
import { describeChanges } from "./diff.ts";
import type { CanvasState } from "./diff.ts";
import { checkFiles, isAllowedPath, mergeAnswer, parseAnswer } from "./files.ts";
import type { FileSet } from "./files.ts";
import type { Llm, LlmMessage } from "./llm.ts";
import { SYSTEM_PROMPT, freshPrompt, repairPrompt, updatePrompt } from "./prompt.ts";
import { runSmoke } from "./smoke.ts";
import type { SmokeResult } from "./smoke.ts";

// The app builder. It asks a model to write the app from the canvas, checks the result (rules, then the
// app is started and its pages are opened), and sends the problems back until it works or the tries run out.
//
// Three modes:
//   fresh   there is no earlier app: write one.
//   update  an earlier app works and the canvas changed: edit it, so the parts that did not change stay as they were.
//   reuse   an earlier app works and the canvas did not change: ship the same files again, no model call.

export type BuildMode = "fresh" | "update" | "reuse";

// The last release that passed its check, read back from the project's repo.
export type BaseApp = { files: FileSet; state: CanvasState };

export type GeneratedApp = {
  files: FileSet;
  summary: string;
  mode: BuildMode;
  // How many times the model was asked.
  calls: number;
  pages: number;
  // What changed on the canvas since the base, in words. Empty for a fresh app.
  changes: string[];
};

export class GenerateError extends Error {}

// One first try plus two repairs.
export const MAX_REPAIRS = 2;

type Log = (level: EventLevel, message: string) => void;

export type GenerateInput = {
  llm: Llm;
  // Folder with the runtime (kit.mjs, server.mjs, smoke.mjs, Dockerfile). Copied next to the files for each check.
  kitDir: string;
  // Throwaway folder where each version is written and started. Emptied every time.
  scratchDir: string;
  goal: string;
  snapshot: CanvasSnapshot;
  plan: BuildPlan;
  base: BaseApp | null;
  signal?: AbortSignal;
  log: Log;
  smoke?: (dir: string, signal?: AbortSignal) => Promise<SmokeResult>;
  maxRepairs?: number;
};

export async function generateApp(input: GenerateInput): Promise<GeneratedApp> {
  const { llm, log, signal } = input;
  if (!fs.existsSync(path.join(input.kitDir, "kit.mjs"))) {
    throw new GenerateError(`The runtime for generated apps is missing (${input.kitDir}). It ships in deploy-templates/runtime.`);
  }
  const smoke = input.smoke ?? runSmoke;
  const maxRepairs = input.maxRepairs ?? MAX_REPAIRS;
  const next: CanvasState = { snapshot: input.snapshot, goal: input.goal };
  const promptInput = { goal: input.goal, snapshot: input.snapshot, plan: input.plan };

  const changes = input.base ? describeChanges(input.base.state, next) : [];
  const mode: BuildMode = !input.base ? "fresh" : changes.length === 0 ? "reuse" : "update";
  let files: FileSet = input.base ? { ...input.base.files } : {};
  let summary = "";
  let calls = 0;
  const messages: LlmMessage[] = [];

  if (mode === "update") {
    log("info", `The canvas changed since the last release (${changes.length} ${changes.length === 1 ? "change" : "changes"}):`);
    for (const line of changes.slice(0, 8)) log("info", `  ${line}`);
    if (changes.length > 8) log("info", `  …and ${changes.length - 8} more.`);
  } else if (mode === "reuse") {
    log("info", "The canvas has not changed since the last release. Shipping the same app again, without asking the model.");
  }

  // Sends one prompt and applies the answer. Returns the problems with the answer itself, such as a cut-off file.
  const ask = async (prompt: string, what: string): Promise<string[]> => {
    messages.push({ role: "user", content: prompt });
    calls += 1;
    log("info", `Asking ${llm.provider} (${llm.model}) to ${what}. This can take a minute or two.`);
    let reply: Awaited<ReturnType<Llm["complete"]>>;
    try {
      reply = await llm.complete({ system: SYSTEM_PROMPT, messages: [...messages], signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new GenerateError(`The app builder (${llm.provider} ${llm.model}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    messages.push({ role: "assistant", content: reply.text });

    const answer = parseAnswer(reply.text);
    const problems = [...answer.problems];
    if (reply.truncated && !answer.cutOff) {
      problems.push("The answer was cut off before it finished. Send the files that are missing or incomplete, and keep the app smaller so it fits (shorter CSS, fewer pages).");
    }
    if (Object.keys(answer.files).length === 0 && answer.deletes.length === 0) {
      problems.push('The answer contained no files. Reply only in the "@@@ FILE path ... @@@ END" format.');
    }
    files = mergeAnswer(files, answer);
    if (answer.summary) summary = answer.summary;
    const names = Object.keys(answer.files);
    const lines = names.reduce((sum, name) => sum + answer.files[name].split("\n").length, 0);
    log("info", `The builder wrote ${names.length} ${names.length === 1 ? "file" : "files"} (${lines} lines).`);
    if (answer.summary) log("info", `Builder: ${answer.summary}`);
    return problems;
  };

  let answerProblems: string[] = [];
  if (mode === "fresh") answerProblems = await ask(freshPrompt(promptInput), "write the app from the canvas");
  else if (mode === "update") {
    answerProblems = await ask(updatePrompt({ ...promptInput, changes, files }), `update the app (${changes.length} canvas ${changes.length === 1 ? "change" : "changes"})`);
  }

  for (let round = 0; ; round += 1) {
    if (signal?.aborted) throw new GenerateError("Stopped.");
    const problems = [...answerProblems, ...checkFiles(files)];
    let pages = 0;
    if (problems.length === 0) {
      log("info", "Starting the app and opening its pages to check it…");
      writeScratch(input.kitDir, input.scratchDir, files);
      const result = await smoke(input.scratchDir, signal);
      problems.push(...result.problems);
      pages = result.pages;
    }
    if (problems.length === 0) {
      log("info", `The check passed: the app started and ${pages} ${pages === 1 ? "page" : "pages"} opened.`);
      return { files, summary, mode, calls, pages, changes };
    }

    for (const problem of problems.slice(0, 8)) log("warn", problem);
    if (problems.length > 8) log("warn", `…and ${problems.length - 8} more problems.`);
    if (round >= maxRepairs) {
      const shown = problems.slice(0, 5).map((problem) => `- ${problem.slice(0, 300)}`).join("\n");
      throw new GenerateError(
        `The app builder could not produce a working app after ${calls} ${calls === 1 ? "try" : "tries"}. The last problems:\n${shown}\nDeploy again to retry, or set DEPLOY_BUILDER=reference to ship the ready-made app where there is one.`,
      );
    }
    log("warn", `The check found ${problems.length} ${problems.length === 1 ? "problem" : "problems"}. Asking the builder to fix ${problems.length === 1 ? "it" : "them"} (try ${calls + 1} of ${maxRepairs + 1}).`);
    // With no earlier question (reuse), the first one is the update prompt with the problems in it.
    answerProblems = await ask(
      messages.length === 0 ? updatePrompt({ ...promptInput, changes: [], files, problems }) : repairPrompt(problems),
      "fix the problems",
    );
  }
}

// Writes the runtime and the generated files to the scratch folder, replacing whatever was there.
export function writeScratch(kitDir: string, scratchDir: string, files: FileSet): void {
  fs.rmSync(scratchDir, { recursive: true, force: true });
  fs.mkdirSync(scratchDir, { recursive: true });
  fs.cpSync(kitDir, scratchDir, { recursive: true, filter: (source) => path.basename(source) !== "node_modules" });
  writeFiles(scratchDir, files);
}

// Only paths that pass the rules are written, and each is resolved to make sure it stays inside the folder.
export function writeFiles(dir: string, files: FileSet): void {
  const root = path.resolve(dir);
  for (const [name, content] of Object.entries(files)) {
    if (!isAllowedPath(name)) continue;
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
