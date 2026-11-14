import fs from "node:fs";
import { runCommand } from "./process.ts";

// Opens the generated app's pages before anything is shipped. The app runs in a child process under
// Node's permission model: it can read its own folder and nothing else, so it cannot reach the network,
// write files, or start programs, and it gets an empty environment, so it sees none of our keys.

export type SmokeResult = { ok: boolean; problems: string[]; pages: number };

const SMOKE_TIMEOUT_MS = 30_000;
const MARKER = "@@SMOKE@@";

type Report = {
  ok?: boolean;
  error?: string | null;
  results?: { path: string; required?: boolean; status: number; error?: string | null; bytes: number }[];
};

export async function runSmoke(dir: string, signal?: AbortSignal): Promise<SmokeResult> {
  // The permission model compares real paths, so a folder reached through a symlink (like /var on macOS) must be resolved.
  const real = fs.realpathSync(dir);
  const run = await runCommand(process.execPath, ["--permission", `--allow-fs-read=${real}`, "smoke.mjs"], {
    cwd: real,
    cleanEnv: true,
    timeoutMs: SMOKE_TIMEOUT_MS,
    signal,
  });
  return interpretSmoke(run.stdout, run.tail, run.code);
}

// Kept apart from the process call so the rules can be tested without starting anything.
export function interpretSmoke(stdout: string, tail: string[], code: number | null): SmokeResult {
  const line = stdout.split("\n").reverse().find((item) => item.startsWith(MARKER));
  if (!line) {
    if (tail.some((item) => item.startsWith("Stopped after"))) {
      return {
        ok: false,
        pages: 0,
        problems: [`The app did not finish starting and answering within ${SMOKE_TIMEOUT_MS / 1000} seconds. Look for an endless loop or a promise that never resolves.`],
      };
    }
    const detail = tail.filter((item) => !/^\(Use `node --trace|ExperimentalWarning/.test(item)).slice(-6).join(" | ");
    return { ok: false, pages: 0, problems: [`The app crashed while starting (exit ${code}). ${detail}`.trim()] };
  }

  let report: Report;
  try {
    report = JSON.parse(line.slice(MARKER.length)) as Report;
  } catch {
    return { ok: false, pages: 0, problems: ["The check of the app produced a report that could not be read."] };
  }
  if (!report.ok) {
    return { ok: false, pages: 0, problems: [`The app failed to start: ${report.error ?? "unknown error"}`] };
  }

  const problems: string[] = [];
  const results = report.results ?? [];
  for (const result of results) {
    if (result.status >= 500) {
      problems.push(`GET ${result.path} answered ${result.status}: ${result.error ?? "the handler threw an error"}`);
    } else if (result.required && result.status >= 400) {
      problems.push(`GET ${result.path} answered ${result.status}, but it must open. Define the route, and make the smoke list match real demo data.`);
    } else if (result.required && result.path === "/" && result.bytes < 200) {
      problems.push(`GET / returned almost nothing (${result.bytes} bytes). The main page must be a real page.`);
    }
  }
  return { ok: problems.length === 0, problems, pages: results.length };
}
