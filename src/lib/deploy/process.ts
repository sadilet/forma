import { spawn } from "node:child_process";

export type RunResult = { code: number | null; stdout: string; stderr: string; tail: string[] };

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  // Called for every line the command prints, from stdout and stderr.
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const MAX_CAPTURE = 1024 * 1024;
const TAIL_LINES = 40;
// Terminal colour codes, which gcloud prints even when it is not attached to a terminal.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

// Runs a program without a shell, so no argument is ever read as shell syntax.
export function runCommand(bin: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Stopped before it started."));
      return;
    }
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    const tail: string[] = [];
    const pending = { out: "", err: "" };
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
      action();
    };

    const emit = (line: string) => {
      const clean = line.replace(ANSI, "").trimEnd();
      if (!clean.trim()) return;
      tail.push(clean);
      if (tail.length > TAIL_LINES) tail.shift();
      options.onLine?.(clean);
    };

    const feed = (key: "out" | "err", chunk: string) => {
      const text = pending[key] + chunk;
      const lines = text.split(/\r\n|\r|\n/);
      pending[key] = lines.pop() ?? "";
      for (const line of lines) emit(line);
    };

    const stop = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    const onAbort = () => stop();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        emit(`Stopped after ${Math.round(options.timeoutMs! / 1000)} seconds.`);
        stop();
      }, options.timeoutMs);
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk;
      feed("out", chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk;
      feed("err", chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          error.code === "ENOENT"
            ? new Error(`"${bin}" was not found. Install it, or set the path in the environment (for gcloud: GCLOUD_BIN).`)
            : error,
        ),
      );
    });
    child.on("close", (code) => {
      if (pending.out) emit(pending.out);
      if (pending.err) emit(pending.err);
      finish(() => resolve({ code, stdout, stderr, tail }));
    });
  });
}
