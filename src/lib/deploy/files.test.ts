import assert from "node:assert/strict";
import test from "node:test";
import { checkFiles, formatFiles, mergeAnswer, parseAnswer } from "./files.ts";

const answer = (...blocks: string[]) => blocks.join("\n");

test("an answer is read into files, a summary and deletions", () => {
  const parsed = parseAnswer(
    answer(
      "@@@ SUMMARY",
      "Built the booking pages. Picked a 20% deposit.",
      "@@@ END",
      "@@@ FILE app/index.mjs",
      "export default function setup() {}",
      "@@@ END",
      "@@@ FILE public/style.css",
      "body { margin: 0 }",
      "@@@ END",
      "@@@ DELETE app/old.mjs",
    ),
  );
  assert.equal(parsed.summary, "Built the booking pages. Picked a 20% deposit.");
  assert.deepEqual(Object.keys(parsed.files), ["app/index.mjs", "public/style.css"]);
  assert.equal(parsed.files["app/index.mjs"], "export default function setup() {}\n");
  assert.deepEqual(parsed.deletes, ["app/old.mjs"]);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.cutOff, null);
});

test("code fences inside a file and chatter around the blocks are ignored", () => {
  const parsed = parseAnswer(
    answer(
      "Sure! Here is the app:",
      "```",
      "@@@ FILE app/index.mjs",
      "```js",
      "const a = 1;",
      "```",
      "@@@ END",
      "```",
      "Hope that helps.",
    ),
  );
  assert.equal(parsed.files["app/index.mjs"], "const a = 1;\n");
});

test("a fence in the middle of a file is kept", () => {
  const parsed = parseAnswer(answer("@@@ FILE app/a.mjs", "const s = `", "```", "`;", "@@@ END"));
  assert.equal(parsed.files["app/a.mjs"], "const s = `\n```\n`;\n");
});

test("an answer that stops inside a file drops that file and says so", () => {
  const parsed = parseAnswer(answer("@@@ FILE app/a.mjs", "ok", "@@@ END", "@@@ FILE app/index.mjs", "export default fun"));
  assert.deepEqual(Object.keys(parsed.files), ["app/a.mjs"]);
  assert.equal(parsed.cutOff, "app/index.mjs");
  assert.match(parsed.problems[0], /stopped in the middle of app\/index\.mjs/);
});

test("a forgotten END does not lose the file before the next marker", () => {
  const parsed = parseAnswer(answer("@@@ FILE app/a.mjs", "a", "@@@ FILE app/b.mjs", "b", "@@@ END"));
  assert.equal(parsed.files["app/a.mjs"], "a\n");
  assert.equal(parsed.files["app/b.mjs"], "b\n");
});

test("windows line endings are handled", () => {
  const parsed = parseAnswer("@@@ FILE app/a.mjs\r\nx\r\n@@@ END\r\n");
  assert.equal(parsed.files["app/a.mjs"], "x\n");
});

test("a file written twice keeps the last version", () => {
  const parsed = parseAnswer(answer("@@@ FILE app/a.mjs", "one", "@@@ END", "@@@ FILE app/a.mjs", "two", "@@@ END"));
  assert.equal(parsed.files["app/a.mjs"], "two\n");
});

const good = {
  "app/index.mjs": 'import { page } from "./layout.mjs";\nimport crypto from "node:crypto";\nexport default function setup() { return { routes: [] }; }\n',
  "app/layout.mjs": "export const page = (body) => body;\n",
  "public/style.css": "body{}\n",
};

test("a well-formed app has no problems", () => {
  assert.deepEqual(checkFiles(good), []);
});

test("the entry file is required", () => {
  const rest: Record<string, string> = { ...good };
  delete rest["app/index.mjs"];
  assert.match(checkFiles(rest).join("\n"), /app\/index\.mjs is missing/);
});

test("paths outside app/ and public/, hidden files and traversal are refused", () => {
  for (const path of ["server.mjs", "Dockerfile", "kit.mjs", "app/../kit.mjs", "app/.env", "public/.htaccess", "/etc/passwd", "app//x.mjs", "app/x.ts", "public/x.exe", ".forma/PLAN.json"]) {
    const problems = checkFiles({ ...good, [path]: "x" });
    assert.ok(problems.some((problem) => problem.includes(`${path} is not an allowed file`)), `${path} was accepted`);
  }
});

test("packages, fs, network and process control are refused with a reason", () => {
  const cases: [string, RegExp][] = [
    ['import express from "express";', /imports "express"/],
    ['import fs from "node:fs";', /node:fs, which is not available/],
    ['import http from "node:http";', /node:http, which is not available/],
    ['const x = await import("node:child_process");', /node:child_process, which is not available/],
    ['const x = require("sqlite3");', /imports "sqlite3"/],
    ['export { a } from "left-pad";', /imports "left-pad"/],
    ['await fetch("https://example.com");', /makes network requests/],
    ["eval('1')", /runs code from strings/],
    ["process.exit(1)", /controls the process/],
    ['import "./missing.mjs";', /missing\.mjs does not exist/],
  ];
  for (const [source, expected] of cases) {
    const problems = checkFiles({ ...good, "app/extra.mjs": `${source}\n` }).join("\n");
    assert.match(problems, expected, source);
  }
});

test("the word cluster or an import-looking sentence in a string is not an import", () => {
  const files = { ...good, "app/copy.mjs": 'export const text = "Our cluster of salons will import from CSV";\n// we never use fetch in server code\n' };
  assert.deepEqual(checkFiles(files), []);
});

test("static files may use fetch and anything else a browser can", () => {
  assert.deepEqual(checkFiles({ ...good, "public/app.js": 'fetch("/api/x").then(() => eval("1"));\n' }), []);
});

test("size and count limits are enforced", () => {
  const many: Record<string, string> = { ...good };
  for (let index = 0; index < 40; index += 1) many[`public/f${index}.txt`] = "x";
  assert.match(checkFiles(many).join("\n"), /There are \d+ files/);
  assert.match(checkFiles({ ...good, "public/big.txt": "x".repeat(200_000) }).join("\n"), /public\/big\.txt is \d+ KB/);
});

test("an update replaces and removes files and leaves the rest", () => {
  const merged = mergeAnswer(good, parseAnswer(answer("@@@ FILE app/layout.mjs", "new", "@@@ END", "@@@ DELETE public/style.css")));
  assert.equal(merged["app/layout.mjs"], "new\n");
  assert.equal(merged["app/index.mjs"], good["app/index.mjs"]);
  assert.equal("public/style.css" in merged, false);
});

test("files are written back in the same format they are read", () => {
  const parsed = parseAnswer(formatFiles(good));
  assert.deepEqual(parsed.files, good);
});
