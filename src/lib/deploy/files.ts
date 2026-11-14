// What the app builder hands back: a set of files in a plain text format, and the rules those files must meet
// before they are run. Nothing here touches the disk.
//
// Format, with every marker at the start of a line:
//   @@@ SUMMARY            two or three sentences, ended by @@@ END
//   @@@ FILE app/index.mjs the whole file, ended by @@@ END
//   @@@ DELETE app/old.mjs one line, only when updating an existing app
//
// Plain text instead of JSON on purpose: code inside JSON strings breaks on a single missed escape.

export type FileSet = Record<string, string>;

export type ParsedAnswer = {
  files: FileSet;
  deletes: string[];
  summary: string;
  // The answer ended inside a block, so the last file is not complete and was left out.
  cutOff: string | null;
  problems: string[];
};

const MARKER = /^@@@\s+(FILE|DELETE|SUMMARY|END)\b[ \t]*(.*?)[ \t]*$/;
const FENCE_OPEN = /^```[\w.+-]*\s*$/;
const FENCE_CLOSE = /^```\s*$/;

export function parseAnswer(text: string): ParsedAnswer {
  const result: ParsedAnswer = { files: {}, deletes: [], summary: "", cutOff: null, problems: [] };
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let open: { kind: "FILE" | "SUMMARY"; path: string; body: string[] } | null = null;

  const close = () => {
    if (!open) return;
    if (open.kind === "SUMMARY") {
      result.summary = open.body.join("\n").trim();
    } else {
      result.files[open.path] = unfence(open.body);
    }
    open = null;
  };

  for (const line of lines) {
    const marker = MARKER.exec(line);
    if (marker) {
      const [, kind, rest] = marker;
      if (kind === "END") {
        close();
        continue;
      }
      // A new block while one is open means the END was forgotten. Keep what was written.
      close();
      if (kind === "DELETE") {
        if (rest) result.deletes.push(rest);
      } else if (kind === "SUMMARY") {
        open = { kind: "SUMMARY", path: "", body: [] };
      } else if (rest) {
        open = { kind: "FILE", path: rest, body: [] };
      } else {
        result.problems.push("A @@@ FILE marker had no path.");
      }
      continue;
    }
    open?.body.push(line);
  }

  if (open) {
    const unfinished = open as { kind: "FILE" | "SUMMARY"; path: string };
    if (unfinished.kind === "FILE") {
      result.cutOff = unfinished.path;
      result.problems.push(`The answer stopped in the middle of ${unfinished.path}, so that file was dropped. Send it again, complete.`);
    } else {
      result.summary = "";
    }
  }
  return result;
}

// Some models put code fences inside the block even when told not to. Take them off.
function unfence(body: string[]): string {
  const lines = [...body];
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length >= 2 && FENCE_OPEN.test(lines[0]) && FENCE_CLOSE.test(lines[lines.length - 1])) {
    lines.shift();
    lines.pop();
  }
  return `${lines.join("\n")}\n`;
}

export function formatFiles(files: FileSet): string {
  return Object.keys(files)
    .sort()
    .map((path) => `@@@ FILE ${path}\n${files[path].replace(/\n$/, "")}\n@@@ END`)
    .join("\n");
}

// ---- Rules -------------------------------------------------------------------------------------------------

export const LIMITS = { files: 30, fileBytes: 150_000, totalBytes: 500_000 };

const APP_PATH = /^app\/[A-Za-z0-9_\-./]+\.(mjs|json)$/;
const PUBLIC_PATH = /^public\/[A-Za-z0-9_\-./]+\.(js|css|html|json|svg|txt|md)$/;

// Node built-ins an app may import. The database comes from the kit, so node:sqlite is not needed.
const ALLOWED_BUILTINS = new Set(["crypto", "path", "url", "util", "events", "buffer", "timers", "assert", "string_decoder"]);

export function isAllowedPath(path: string): boolean {
  if (path.split("/").some((part) => part === "" || part.startsWith("."))) return false;
  return APP_PATH.test(path) || PUBLIC_PATH.test(path);
}

const IMPORT_SPECIFIER =
  /\bimport\s+(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)|\bexport\s+[^'"`;]*?\s+from\s+["']([^"']+)["']/g;

const FORBIDDEN: { pattern: RegExp; message: string }[] = [
  {
    pattern: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/,
    message: "makes network requests. Server code must not call out; simulate external services. Browser code belongs in public/*.js, not inside a server file.",
  },
  { pattern: /\beval\s*\(|\bnew\s+Function\s*\(/, message: "runs code from strings. Remove it." },
  { pattern: /\bprocess\s*\.\s*(?:exit|kill|abort|chdir|binding)\b/, message: "controls the process. Remove it." },
];

// Returns what is wrong with the file set, in words the builder can act on. An empty list means it may run.
export function checkFiles(files: FileSet): string[] {
  const problems: string[] = [];
  const paths = Object.keys(files);

  if (paths.length > LIMITS.files) problems.push(`There are ${paths.length} files. Use at most ${LIMITS.files}.`);
  let total = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(files[path]);
    total += size;
    if (!isAllowedPath(path)) {
      problems.push(`${path} is not an allowed file. Allowed: app/*.mjs and app/*.json for server code, and public/* (js, css, html, json, svg, txt, md) for static files.`);
    } else if (size > LIMITS.fileBytes) {
      problems.push(`${path} is ${Math.round(size / 1024)} KB. Keep each file under ${Math.round(LIMITS.fileBytes / 1024)} KB.`);
    }
  }
  if (total > LIMITS.totalBytes) problems.push(`The app is ${Math.round(total / 1024)} KB in total. Keep it under ${Math.round(LIMITS.totalBytes / 1024)} KB.`);
  if (!("app/index.mjs" in files)) problems.push("app/index.mjs is missing. It must export a default setup function.");

  for (const path of paths) {
    if (!APP_PATH.test(path) || !path.endsWith(".mjs")) continue;
    const source = files[path];
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(source)) problems.push(`${path} ${rule.message}`);
    }
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const target = resolveRelative(path, specifier);
        if (!(target in files)) problems.push(`${path} imports ${specifier}, but ${target} does not exist. Import your own files with a relative path and the .mjs extension.`);
      } else if (specifier.startsWith("node:")) {
        if (!ALLOWED_BUILTINS.has(specifier.slice(5))) problems.push(`${path} imports ${specifier}, which is not available. Allowed: ${[...ALLOWED_BUILTINS].map((name) => `node:${name}`).join(", ")}.`);
      } else {
        problems.push(`${path} imports "${specifier}". There are no packages: use only the allowed node: built-ins and your own files.`);
      }
    }
  }
  return problems;
}

function resolveRelative(from: string, specifier: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

// Applies an answer on top of the files so far. Files in the answer replace files with the same path.
export function mergeAnswer(current: FileSet, answer: ParsedAnswer): FileSet {
  const next: FileSet = { ...current, ...answer.files };
  for (const path of answer.deletes) delete next[path];
  return next;
}
