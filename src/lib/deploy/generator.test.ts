import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { GenerateError, generateApp } from "./generator.ts";
import type { BaseApp, GenerateInput } from "./generator.ts";
import { planFromSnapshot } from "./planner.ts";
import { answerOf, appFiles, canvas, fakeLlm, indexSource } from "./test-app.ts";

const kitDir = path.resolve("deploy-templates", "runtime");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-generator-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const goal = "SlotGuard cuts no-show losses.";

function run(llm: ReturnType<typeof fakeLlm>, overrides: Partial<GenerateInput> = {}) {
  const log: string[] = [];
  const input: GenerateInput = {
    llm,
    kitDir,
    scratchDir: fs.mkdtempSync(path.join(tmp, "scratch-")),
    goal,
    snapshot: canvas,
    plan: planFromSnapshot(canvas, goal),
    base: null,
    log: (level, message) => log.push(`${level}: ${message}`),
    ...overrides,
  };
  return { promise: generateApp(input), log };
}

test("a first build asks once, checks the app, and returns its files", async () => {
  const llm = fakeLlm([answerOf(appFiles("Studio"), "Booking pages with a 20% deposit.")]);
  const { promise, log } = run(llm);
  const app = await promise;
  assert.equal(app.mode, "fresh");
  assert.equal(app.calls, 1);
  assert.equal(llm.calls.length, 1);
  assert.deepEqual(Object.keys(app.files).sort(), ["app/index.mjs", "public/style.css"]);
  assert.equal(app.summary, "Booking pages with a 20% deposit.");
  assert.ok(app.pages >= 4);
  assert.ok(log.some((line) => /The check passed/.test(line)));
});

test("the model is given the whole canvas, the decisions that bind it, and the rules", async () => {
  const llm = fakeLlm([answerOf(appFiles())]);
  await run(llm).promise;
  const [call] = llm.calls;
  assert.match(call.system, /GET \/about/);
  assert.match(call.system, /smoke/);
  const prompt = call.messages[0].content;
  assert.match(prompt, /SlotGuard cuts no-show losses\./);
  assert.match(prompt, /SCREEN "Booking page": Client picks a time\./);
  assert.match(prompt, /DECISION "Deposit rules": 20% of the price\./);
  assert.match(prompt, /"Booking page" -> "Store" \(writes\)/);
  assert.match(prompt, /Decision that applies: Deposit rules: 20% of the price\./);
});

test("a problem found by the check is sent back and the fixed app is used", async () => {
  const broken = appFiles();
  broken["app/index.mjs"] = indexSource().replace('db.prepare("SELECT * FROM items")', 'db.prepare("SELECT * FROM missing_table")');
  const llm = fakeLlm([answerOf(broken), answerOf({ "app/index.mjs": indexSource() }, "Fixed the query.")]);
  const { promise, log } = run(llm);
  const app = await promise;
  assert.equal(app.calls, 2);
  assert.equal(llm.calls.length, 2);
  assert.match(llm.calls[1].messages[2].content, /GET \/ answered 500/);
  assert.match(llm.calls[1].messages[2].content, /no such table: missing_table/);
  assert.equal(llm.calls[1].messages.length, 3, "the repair continues the same conversation");
  assert.equal(app.files["public/style.css"].length > 0, true, "a repair only has to send the files it changed");
  assert.ok(log.some((line) => /Asking the builder to fix it \(try 2 of 3\)/.test(line)));
});

test("rule violations are sent back without starting the app", async () => {
  const bad = { ...appFiles(), "app/util.mjs": 'import express from "express";\nexport default express;\n' };
  const llm = fakeLlm([answerOf(bad), answerOf({ "app/util.mjs": "export default 1;\n" })]);
  let started = 0;
  const { promise } = run(llm, {
    smoke: async () => {
      started += 1;
      return { ok: true, problems: [], pages: 4 };
    },
  });
  await promise;
  assert.match(llm.calls[1].messages[2].content, /imports "express"/);
  assert.equal(started, 1, "the app was only started once the rules passed");
});

test("an answer that is cut off is completed in the next round", async () => {
  const full = answerOf({ "app/index.mjs": indexSource() });
  const llm = fakeLlm([{ text: full.slice(0, full.length - 60), truncated: true }, answerOf(appFiles())]);
  const app = await run(llm).promise;
  assert.equal(app.calls, 2);
  assert.match(llm.calls[1].messages[2].content, /stopped in the middle of app\/index\.mjs/);
});

test("an answer with no files is a problem, not a crash", async () => {
  const llm = fakeLlm(["I would be happy to help, but what kind of app?", answerOf(appFiles())]);
  const app = await run(llm).promise;
  assert.equal(app.calls, 2);
  assert.match(llm.calls[1].messages[2].content, /contained no files/);
});

test("after the last repair the build fails and says what was wrong", async () => {
  const broken = { "app/index.mjs": "export default function setup() { return { routes: [] }; }\n" };
  const llm = fakeLlm([answerOf(broken)]);
  const { promise } = run(llm);
  await assert.rejects(promise, (error: Error) => {
    assert.ok(error instanceof GenerateError);
    assert.match(error.message, /could not produce a working app after 3 tries/);
    assert.match(error.message, /GET \/ answered 404/);
    assert.match(error.message, /DEPLOY_BUILDER=reference/);
    return true;
  });
  assert.equal(llm.calls.length, 3);
});

test("a failing model call is reported with the provider and model", async () => {
  const llm = fakeLlm([]);
  llm.complete = async () => {
    throw new Error("429 quota exceeded");
  };
  await assert.rejects(run(llm).promise, /The app builder \(gemini fake-model\) failed: 429 quota exceeded/);
});

test("stopping the job stops the build before the next call", async () => {
  const controller = new AbortController();
  const llm = fakeLlm([answerOf({ "app/index.mjs": "export default function setup() { return { routes: [] }; }\n" })]);
  const original = llm.complete.bind(llm);
  llm.complete = async (request) => {
    const result = await original(request);
    controller.abort("shutdown");
    return result;
  };
  await assert.rejects(run(llm, { signal: controller.signal }).promise, /Stopped/);
  assert.equal(llm.calls.length, 1);
});

// ---- Updating an app that already exists ------------------------------------------------------------------------

const baseApp = (): BaseApp => ({ files: appFiles("Studio"), state: { snapshot: canvas, goal } });

test("with an unchanged canvas the same app is checked and shipped without asking the model", async () => {
  const llm = fakeLlm([answerOf(appFiles("Other"))]);
  const { promise, log } = run(llm, { base: baseApp() });
  const app = await promise;
  assert.equal(app.mode, "reuse");
  assert.equal(app.calls, 0);
  assert.equal(llm.calls.length, 0);
  assert.deepEqual(app.files, appFiles("Studio"));
  assert.ok(log.some((line) => /has not changed/.test(line)));
});

test("a changed canvas updates the app: the model sees the change and the current files, and only edits what it must", async () => {
  const changed: CanvasSnapshot = structuredClone(canvas);
  changed.blocks[1].description = "30% of the price, refundable until 48 hours before.";
  const llm = fakeLlm([answerOf({ "app/index.mjs": indexSource("Studio v2") }, "Raised the deposit to 30%.")]);
  const { promise, log } = run(llm, { base: baseApp(), snapshot: changed, plan: planFromSnapshot(changed, goal) });
  const app = await promise;
  assert.equal(app.mode, "update");
  assert.equal(app.calls, 1);
  assert.equal(app.changes.length, 1);
  const prompt = llm.calls[0].messages[0].content;
  assert.match(prompt, /# What changed on the canvas\n- Changed decision "Deposit rules"/);
  assert.match(prompt, /was "20% of the price\." and is now "30% of the price, refundable until 48 hours before\."/);
  assert.match(prompt, /@@@ FILE app\/index\.mjs/);
  assert.match(prompt, /@@@ FILE public\/style\.css/);
  assert.match(app.files["app/index.mjs"], /Studio v2/);
  assert.equal(app.files["public/style.css"], appFiles()["public/style.css"], "the file the model did not send is kept");
  assert.ok(log.some((line) => /canvas changed since the last release \(1 change\)/.test(line)));
});

test("a goal change is also a change", async () => {
  const llm = fakeLlm([answerOf({ "app/index.mjs": indexSource("Studio") })]);
  const app = await run(llm, { base: baseApp(), goal: "A different goal." }).promise;
  assert.equal(app.mode, "update");
  assert.match(llm.calls[0].messages[0].content, /The product goal changed/);
});

test("an update can remove files the app no longer needs", async () => {
  const base = baseApp();
  base.files["app/old.mjs"] = "export default 1;\n";
  const changed: CanvasSnapshot = structuredClone(canvas);
  changed.blocks.pop();
  changed.connections = [];
  const llm = fakeLlm([`${answerOf({})}@@@ DELETE app/old.mjs\n`]);
  const app = await run(llm, { base, snapshot: changed, plan: planFromSnapshot(changed, goal) }).promise;
  assert.equal("app/old.mjs" in app.files, false);
  assert.ok("app/index.mjs" in app.files);
});

test("a stored app that no longer passes the check is repaired even if the canvas did not change", async () => {
  const base = baseApp();
  base.files["app/index.mjs"] = base.files["app/index.mjs"].replace('db.prepare("SELECT * FROM items")', 'db.prepare("SELECT * FROM gone")');
  const llm = fakeLlm([answerOf({ "app/index.mjs": indexSource("Studio") })]);
  const app = await run(llm, { base }).promise;
  assert.equal(app.mode, "reuse");
  assert.equal(app.calls, 1);
  const prompt = llm.calls[0].messages[0].content;
  assert.match(prompt, /The canvas has not changed, but the app failed the check/);
  assert.match(prompt, /no such table: gone/);
});

test("the runtime folder is required", async () => {
  const llm = fakeLlm([answerOf(appFiles())]);
  await assert.rejects(run(llm, { kitDir: path.join(tmp, "nowhere") }).promise, /runtime for generated apps is missing/);
});

test("the scratch folder is emptied before every check", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "scratch-"));
  fs.writeFileSync(path.join(dir, "junk.txt"), "x");
  const llm = fakeLlm([answerOf(appFiles())]);
  await generateApp({ llm, kitDir, scratchDir: dir, goal, snapshot: canvas, plan: planFromSnapshot(canvas, goal), base: null, log: () => undefined });
  assert.equal(fs.existsSync(path.join(dir, "junk.txt")), false);
  assert.ok(fs.existsSync(path.join(dir, "kit.mjs")));
  assert.ok(fs.existsSync(path.join(dir, "app", "index.mjs")));
});
