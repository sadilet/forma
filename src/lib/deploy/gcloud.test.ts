import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.ts";
import { deployArgs, describeArgs, parseService } from "./gcloud.ts";
import { runCommand } from "./process.ts";

const config = loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", GCP_REGION: "europe-north1" }, "/repo");
const input = { serviceName: "forma-project-slotguard", projectId: "project-slotguard", releaseId: "abc-123", sourceDir: "/repo/data/deploy/p/repo" };

function flag(args: string[], name: string) {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `missing ${name}`);
  return args[index + 1];
}

test("the deploy command carries the project, region, source, and a single instance", () => {
  const args = deployArgs(config, input);
  assert.deepEqual(args.slice(0, 3), ["run", "deploy", "forma-project-slotguard"]);
  assert.equal(flag(args, "--source"), input.sourceDir);
  assert.equal(flag(args, "--project"), "junction26hel-7607");
  assert.equal(flag(args, "--region"), "europe-north1");
  assert.equal(flag(args, "--port"), "8080");
  assert.equal(flag(args, "--max-instances"), "1");
  assert.equal(flag(args, "--min-instances"), "0");
  assert.equal(flag(args, "--memory"), "512Mi");
  assert.equal(flag(args, "--labels"), "forma=true,forma-project=project-slotguard");
  assert.equal(flag(args, "--set-env-vars"), "FORMA_RELEASE=abc-123");
  assert.ok(args.includes("--quiet"), "it must never wait for an answer");
});

test("the service is public by default, or skips the access check when configured", () => {
  assert.ok(deployArgs(config, input).includes("--allow-unauthenticated"));
  const other = loadConfig(
    { GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_PUBLIC_ACCESS: "no-invoker-iam-check" },
    "/repo",
  );
  const args = deployArgs(other, input);
  assert.ok(args.includes("--no-invoker-iam-check"));
  assert.equal(args.includes("--allow-unauthenticated"), false);
});

test("an argument with shell characters stays one argument", () => {
  const args = deployArgs(config, { ...input, sourceDir: "/tmp/a b; rm -rf /" });
  assert.equal(flag(args, "--source"), "/tmp/a b; rm -rf /");
});

test("describe asks for JSON in the same project and region", () => {
  const args = describeArgs(config, "svc");
  assert.deepEqual(args.slice(0, 4), ["run", "services", "describe", "svc"]);
  assert.ok(args.includes("--format=json"));
  assert.equal(flag(args, "--region"), "europe-north1");
});

test("the service address and revision come from the describe output", () => {
  const shipped = parseService(
    JSON.stringify({ status: { url: "https://forma-x-abc.europe-north1.run.app", latestReadyRevisionName: "forma-x-00003-xyz" } }),
  );
  assert.deepEqual(shipped, { url: "https://forma-x-abc.europe-north1.run.app", revision: "forma-x-00003-xyz" });
});

test("a missing or insecure address is an error, not a silent success", () => {
  assert.throws(() => parseService("{}"), /no public address/);
  assert.throws(() => parseService(JSON.stringify({ status: { url: "http://x" } })), /no public address/);
  assert.throws(() => parseService("not json"), /valid JSON/);
});

test("config rejects values that would break the command", () => {
  assert.throws(() => loadConfig({}, "/repo"), /GCP_PROJECT_ID is not set/);
  assert.throws(() => loadConfig({ GCP_PROJECT_ID: "BAD ID" }, "/repo"), /not a valid project id/);
  assert.throws(() => loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", GCP_REGION: "mars" }, "/repo"), /not a valid region/);
  assert.throws(() => loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_MEMORY: "lots" }, "/repo"), /DEPLOY_MEMORY/);
  assert.throws(() => loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_MIN_INSTANCES: "2" }, "/repo"), /cannot be larger/);
  assert.throws(() => loadConfig({ GCP_PROJECT_ID: "junction26hel-7607", DEPLOY_PUBLIC_ACCESS: "yes" }, "/repo"), /DEPLOY_PUBLIC_ACCESS/);
});

test("a dry run needs no Google Cloud settings", () => {
  const dry = loadConfig({ DEPLOY_DRY_RUN: "1" }, "/repo");
  assert.equal(dry.dryRun, true);
  assert.equal(dry.templatesDir, "/repo/deploy-templates");
});

test("a command's output arrives line by line and its exit code is kept", async () => {
  const lines: string[] = [];
  const result = await runCommand(
    process.execPath,
    ["-e", "console.log('one'); console.error('\\x1b[31mtwo\\x1b[0m'); process.stdout.write('three'); process.exit(3)"],
    { onLine: (line) => lines.push(line) },
  );
  assert.equal(result.code, 3);
  assert.deepEqual(lines.sort(), ["one", "three", "two"]);
  assert.match(result.stdout, /one/);
});

test("a missing program gives a message that says what to do", async () => {
  await assert.rejects(runCommand("definitely-not-installed-gcloud", []), /was not found/);
});

test("a command stops when it is aborted", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const running = runCommand(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const result = await running;
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < 10_000);
});

test("a command stops when it runs too long", async () => {
  const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { timeoutMs: 150 });
  assert.notEqual(result.code, 0);
  assert.match(result.tail.join("\n"), /Stopped after/);
});
