import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import test, { after } from "node:test";
import { writeScratch } from "./generator.ts";
import { interpretSmoke, runSmoke } from "./smoke.ts";
import { appFiles } from "./test-app.ts";

const kitDir = path.resolve("deploy-templates", "runtime");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-smoke-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const report = (value: unknown) => `noise\n@@SMOKE@@${JSON.stringify(value)}\n`;

test("a report with every page answering is a pass", () => {
  const result = interpretSmoke(
    report({ ok: true, results: [{ path: "/", required: true, status: 200, bytes: 900 }, { path: "/about", required: true, status: 200, bytes: 400 }] }),
    [],
    0,
  );
  assert.deepEqual(result, { ok: true, problems: [], pages: 2 });
});

test("a 500 anywhere, a missing required page, and an empty home page are problems", () => {
  const result = interpretSmoke(
    report({
      ok: true,
      results: [
        { path: "/", required: true, status: 200, bytes: 20 },
        { path: "/about", required: true, status: 404, bytes: 9 },
        { path: "/boom", required: false, status: 500, error: "TypeError: x is undefined | at handler", bytes: 21 },
        { path: "/maybe", required: false, status: 404, bytes: 9 },
      ],
    }),
    [],
    0,
  );
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 3);
  assert.match(result.problems.join("\n"), /GET \/ returned almost nothing/);
  assert.match(result.problems.join("\n"), /GET \/about answered 404, but it must open/);
  assert.match(result.problems.join("\n"), /GET \/boom answered 500: TypeError: x is undefined/);
});

test("a failed start, a crash and a timeout each give a clear problem", () => {
  assert.match(interpretSmoke(report({ ok: false, error: "SyntaxError: Unexpected token" }), [], 0).problems[0], /failed to start: SyntaxError/);
  assert.match(interpretSmoke("", ["Error: boom", "at x"], 1).problems[0], /crashed while starting \(exit 1\)\. Error: boom \| at x/);
  assert.match(interpretSmoke("", ["Stopped after 30 seconds."], null).problems[0], /did not finish/);
  assert.match(interpretSmoke("@@SMOKE@@{not json", [], 0).problems[0], /could not be read/);
});

test("a real app starts and its pages open", async () => {
  const dir = path.join(tmp, "good");
  writeScratch(kitDir, dir, appFiles());
  const result = await runSmoke(dir);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.ok(result.pages >= 4, `opened ${result.pages} pages`);
});

test("a handler that throws is found by name and path", async () => {
  const dir = path.join(tmp, "throws");
  const files = appFiles();
  files["app/index.mjs"] = files["app/index.mjs"].replace('{ method: "GET", path: "/about", handler: () =>', '{ method: "GET", path: "/about", handler: () => { throw new TypeError("no layout"); }, unused: () =>');
  writeScratch(kitDir, dir, files);
  const result = await runSmoke(dir);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /GET \/about answered 500: TypeError: no layout/);
});

test("a syntax error is reported as a failed start", async () => {
  const dir = path.join(tmp, "syntax");
  writeScratch(kitDir, dir, { ...appFiles(), "app/index.mjs": "export default function setup( {\n" });
  const result = await runSmoke(dir);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /SyntaxError/);
});

test("the app cannot read files outside its folder", async () => {
  const dir = path.join(tmp, "reads");
  const files = appFiles();
  files["app/index.mjs"] = `const fs = process.getBuiltinModule("node:fs");\nfs.readFileSync("/etc/hosts", "utf8");\n${files["app/index.mjs"]}`;
  writeScratch(kitDir, dir, files);
  const result = await runSmoke(dir);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /ERR_ACCESS_DENIED|Access to this API has been restricted/);
});

test("the app cannot write files, start programs or open sockets", async () => {
  // A real listener, so a connection that is allowed would succeed and not just fail for lack of one.
  const listener = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as net.AddressInfo).port;
  try {
    for (const [name, code] of [
      ["write", 'process.getBuiltinModule("node:fs").writeFileSync("/tmp/forma-escape.txt", "x");'],
      ["spawn", 'process.getBuiltinModule("node:child_process").execSync("echo hi");'],
      [
        "net",
        `await new Promise((resolve, reject) => { const socket = process.getBuiltinModule("node:net").connect(${port}, "127.0.0.1"); socket.on("connect", resolve); socket.on("error", reject); });`,
      ],
    ]) {
      const dir = path.join(tmp, name);
      const files = appFiles();
      files["app/index.mjs"] = `${code}\n${files["app/index.mjs"]}`;
      writeScratch(kitDir, dir, files);
      const result = await runSmoke(dir);
      assert.equal(result.ok, false, `${name} was allowed`);
      assert.match(result.problems.join("\n"), /ERR_ACCESS_DENIED|Access to this API has been restricted/, `${name}: ${result.problems.join(" ")}`);
    }
  } finally {
    listener.close();
  }
  assert.equal(fs.existsSync("/tmp/forma-escape.txt"), false);
});

test("the app sees none of this process's environment", async () => {
  process.env.FORMA_TEST_SECRET = "hunter2";
  try {
    const dir = path.join(tmp, "env");
    const files = appFiles();
    files["app/index.mjs"] = `if (process.env.FORMA_TEST_SECRET) throw new Error("the secret leaked");\n${files["app/index.mjs"]}`;
    writeScratch(kitDir, dir, files);
    const result = await runSmoke(dir);
    assert.deepEqual(result.problems, []);
  } finally {
    delete process.env.FORMA_TEST_SECRET;
  }
});

test("an app that never finishes is stopped when the job is cancelled", { timeout: 60_000 }, async () => {
  const dir = path.join(tmp, "hangs");
  const files = appFiles();
  files["app/index.mjs"] = `await new Promise(() => setInterval(() => {}, 1000));\n${files["app/index.mjs"]}`;
  writeScratch(kitDir, dir, files);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 1500);
  const result = await runSmoke(dir, controller.signal);
  assert.equal(result.ok, false);
});
