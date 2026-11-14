import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, loadConfig } from "./config.ts";
import { isTransient, loadLlm, withRetry } from "./llm.ts";

test("no key means no model, so the caller can say what to add", () => {
  assert.equal(loadLlm({}), null);
  assert.equal(loadLlm({ GEMINI_API_KEY: "  ", OPENAI_API_KEY: "" }), null);
});

test("Gemini is used when its key is set, OpenAI otherwise, as in the rest of Forma", () => {
  assert.deepEqual(pick(loadLlm({ GEMINI_API_KEY: "g" })), { provider: "gemini", model: "gemini-2.5-flash" });
  assert.deepEqual(pick(loadLlm({ OPENAI_API_KEY: "o" })), { provider: "openai", model: "gpt-4.1-mini" });
  assert.equal(pick(loadLlm({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" })).provider, "gemini");
  assert.equal(pick(loadLlm({ GOOGLE_API_KEY: "g" })).provider, "gemini");
});

test("AI_PROVIDER picks one, and a missing key for it is not silently swapped", () => {
  assert.equal(pick(loadLlm({ AI_PROVIDER: "openai", GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" })).provider, "openai");
  assert.equal(loadLlm({ AI_PROVIDER: "openai", GEMINI_API_KEY: "g" }), null);
  assert.equal(pick(loadLlm({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" })).provider, "gemini");
  assert.equal(loadLlm({ AI_PROVIDER: "gemini", OPENAI_API_KEY: "o" }), null);
});

test("the model can be chosen for deploys alone", () => {
  assert.equal(pick(loadLlm({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-x" })).model, "gemini-x");
  assert.equal(pick(loadLlm({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-x", DEPLOY_MODEL: "gemini-pro-y" })).model, "gemini-pro-y");
  assert.equal(pick(loadLlm({ OPENAI_API_KEY: "o", OPENAI_MODEL: "gpt-x" })).model, "gpt-x");
});

function pick(llm: ReturnType<typeof loadLlm>) {
  assert.ok(llm, "a model was expected");
  return { provider: llm.provider, model: llm.model };
}

test("busy-model errors are worth retrying and real ones are not", () => {
  for (const message of ["429 Too Many Requests", "503 UNAVAILABLE: The model is overloaded", "RESOURCE_EXHAUSTED", "fetch failed", "read ECONNRESET"]) {
    assert.equal(isTransient(new Error(message)), true, message);
  }
  for (const message of ["400 INVALID_ARGUMENT: bad schema", "401 API key not valid", "Unexpected token"]) {
    assert.equal(isTransient(new Error(message)), false, message);
  }
  assert.equal(isTransient(Object.assign(new Error("x"), { status: 503 })), true);
  assert.equal(isTransient(Object.assign(new Error("503 in the text"), { status: 400 })), false);
  assert.equal(isTransient("not an error"), false);
});

test("a busy model is asked again after a wait, and the waits are the ones given", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("503 UNAVAILABLE");
      return "done";
    },
    undefined,
    { waits: [10, 20], sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(result, "done");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("retrying stops for an error that will not go away, for too many tries, and for a stop request", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw new Error("401 API key not valid");
    }, undefined, { waits: [1, 1], sleep: async () => undefined }),
    /401/,
  );
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw new Error("429");
    }, undefined, { waits: [1, 1], sleep: async () => undefined }),
    /429/,
  );
  assert.equal(calls, 3);

  calls = 0;
  const controller = new AbortController();
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      controller.abort();
      throw new Error("503");
    }, controller.signal, { waits: [1, 1], sleep: async () => undefined }),
    /503/,
  );
  assert.equal(calls, 1);
});

test("DEPLOY_BUILDER is validated and defaults to auto", () => {
  const base = { GCP_PROJECT_ID: "junction26hel-7607" };
  assert.equal(loadConfig(base).builder, "auto");
  assert.equal(loadConfig({ ...base, DEPLOY_BUILDER: "" }).builder, "auto");
  assert.equal(loadConfig({ ...base, DEPLOY_BUILDER: " Agent " }).builder, "agent");
  assert.equal(loadConfig({ ...base, DEPLOY_BUILDER: "reference" }).builder, "reference");
  assert.throws(() => loadConfig({ ...base, DEPLOY_BUILDER: "robot" }), ConfigError);
});
