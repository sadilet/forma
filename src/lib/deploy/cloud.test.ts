import assert from "node:assert/strict";
import test from "node:test";
import { CloudConfigError, cloudDatabaseUrl, envFileContents, imageName, planCloud } from "./cloud.ts";

const base = { GCP_PROJECT_ID: "junction26hel-7607", POSTGRES_PASSWORD: "pw", SESSION_SECRET: "a-real-secret" };

test("the database address is a Cloud SQL socket, and the password is escaped", () => {
  assert.equal(
    cloudDatabaseUrl("p:r:i", "forma", "p@ss/w:rd"),
    "postgres://postgres:p%40ss%2Fw%3Ard@/forma?host=/cloudsql/p:r:i",
  );
});

test("the plan fills in the instance, database, and service names", () => {
  const plan = planCloud(base);
  assert.equal(plan.region, "europe-north1");
  assert.equal(plan.instance, "junction26hel-7607:europe-north1:forma");
  assert.equal(plan.database, "forma");
  assert.equal(plan.web.service, "forma");
  assert.equal(plan.worker.service, "forma-worker");
  assert.equal(plan.web.env.DATABASE_URL, "postgres://postgres:pw@/forma?host=/cloudsql/junction26hel-7607:europe-north1:forma");
  assert.equal(plan.web.env.DATABASE_URL, plan.worker.env.DATABASE_URL);
  assert.equal(plan.generatedSessionSecret, null);
});

test("each service gets only what it needs", () => {
  const plan = planCloud({
    ...base,
    GEMINI_API_KEY: "g",
    LIVEBLOCKS_SECRET_KEY: "l",
    CONTEXT_DEV_API_KEY: "c",
    DEPLOY_BUILDER: "agent",
    DEPLOY_GIT_REMOTE: "git@github.com:a/b.git",
    GCLOUD_BIN: "/Users/me/gcloud",
    DEPLOY_DRY_RUN: "1",
    DEPLOY_GIT_SSH_KEY: "example_github_ssh",
  });
  assert.equal(plan.web.env.GEMINI_API_KEY, "g");
  assert.equal(plan.web.env.LIVEBLOCKS_SECRET_KEY, "l");
  assert.equal(plan.web.env.DEPLOY_BUILDER, undefined, "worker settings stay out of the web service");
  assert.equal(plan.worker.env.GEMINI_API_KEY, "g", "the worker needs the model key to write apps");
  assert.equal(plan.worker.env.LIVEBLOCKS_SECRET_KEY, undefined);
  assert.equal(plan.worker.env.SESSION_SECRET, undefined, "the worker has no use for the login secret");
  assert.equal(plan.worker.env.DEPLOY_BUILDER, "agent");
  assert.equal(plan.worker.env.DEPLOY_GIT_REMOTE, "git@github.com:a/b.git");
  assert.equal(plan.worker.env.DEPLOY_GIT_SSH_KEY, "example_github_ssh");
  assert.equal(plan.worker.env.GCLOUD_BIN, undefined, "a path on this laptop means nothing in the cloud");
  assert.equal(plan.worker.env.DEPLOY_DRY_RUN, undefined, "a dry run must never reach the cloud worker");
  assert.equal(plan.worker.env.GCP_PROJECT_ID, "junction26hel-7607");
});

test("empty values are not sent", () => {
  const plan = planCloud({ ...base, GEMINI_API_KEY: "  ", DEPLOY_BUILDER: "" });
  assert.equal("GEMINI_API_KEY" in plan.web.env, false);
  assert.equal("DEPLOY_BUILDER" in plan.worker.env, false);
});

test("the public development session secret is replaced by a new one", () => {
  for (const SESSION_SECRET of [undefined, "", "forma-dev-session-secret"]) {
    const plan = planCloud({ ...base, SESSION_SECRET });
    assert.ok(plan.generatedSessionSecret && plan.generatedSessionSecret.length >= 32);
    assert.equal(plan.web.env.SESSION_SECRET, plan.generatedSessionSecret);
  }
});

test("missing settings are reported in plain words", () => {
  assert.throws(() => planCloud({ POSTGRES_PASSWORD: "x" }), (error: Error) => error instanceof CloudConfigError && /GCP_PROJECT_ID/.test(error.message));
  assert.throws(() => planCloud({ GCP_PROJECT_ID: "p" }), (error: Error) => error instanceof CloudConfigError && /POSTGRES_PASSWORD/.test(error.message));
  assert.throws(() => planCloud({ ...base, CLOUD_SQL_INSTANCE: "forma" }), /project:region:instance/);
  assert.throws(() => planCloud({ ...base, CLOUD_SQL_DATABASE: "Forma-1" }), /lowercase/);
});

test("the env file is valid YAML and survives quotes and newlines", () => {
  const text = envFileContents({ A: 'say "hi"', B: "line1\nline2", C: "x: y" });
  assert.deepEqual(JSON.parse(text), { A: 'say "hi"', B: "line1\nline2", C: "x: y" });
});

test("image names point at Artifact Registry in the same region", () => {
  assert.equal(imageName(planCloud(base), "web", "t1"), "europe-north1-docker.pkg.dev/junction26hel-7607/forma/web:t1");
});
