import assert from "node:assert/strict";
import test from "node:test";
import { isLookupKind, LOOKUP_KINDS, parseClientMessage, sampleRateOf, VOICE_TOOLS } from "./protocol.ts";
import { signTicket, verifyTicket } from "./ticket.ts";

const secret = "test-secret";

test("a fresh ticket verifies and carries the user and project", () => {
  const { ticket } = signTicket({ userId: "u1", projectId: "p1", secret, now: 1_000 });
  const verified = verifyTicket(ticket, secret, 1_500);
  assert.equal(verified?.userId, "u1");
  assert.equal(verified?.projectId, "p1");
});

test("an expired ticket is refused", () => {
  const { ticket } = signTicket({ userId: "u1", projectId: "p1", secret, now: 1_000, ttlMs: 100 });
  assert.equal(verifyTicket(ticket, secret, 1_101), null);
});

test("a ticket signed with another secret, or edited, is refused", () => {
  const { ticket } = signTicket({ userId: "u1", projectId: "p1", secret, now: 1_000 });
  assert.equal(verifyTicket(ticket, "other-secret", 1_100), null);
  const [payload, signature] = ticket.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "u2", p: "p1", e: 9e15 })).toString("base64url");
  assert.equal(verifyTicket(`${forged}.${signature}`, secret, 1_100), null);
  assert.equal(verifyTicket(`${payload}`, secret, 1_100), null);
  assert.equal(verifyTicket("", secret, 1_100), null);
});

test("a session cookie is not a voice ticket", () => {
  assert.equal(verifyTicket("abc.def", secret), null);
});

test("accepts the client messages the relay understands", () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "start", instructions: "Be brief." })), {
    type: "start",
    instructions: "Be brief.",
  });
  assert.equal(parseClientMessage(JSON.stringify({ type: "audio", data: "AAA=" }))?.type, "audio");
  assert.equal(parseClientMessage(JSON.stringify({ type: "video", data: "/9j/" }))?.type, "video");
  assert.equal(parseClientMessage(JSON.stringify({ type: "audioStreamEnd" }))?.type, "audioStreamEnd");
  assert.equal(
    parseClientMessage(
      JSON.stringify({ type: "toolResponse", responses: [{ id: "c1", name: "get_canvas_details", response: { result: {} } }] }),
    )?.type,
    "toolResponse",
  );
});

test("rejects unknown, malformed, and oversized client messages", () => {
  assert.equal(parseClientMessage("not json"), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "shell", command: "ls" })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "toolResponse", responses: [] })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "text", text: "x".repeat(4_001) })), null);
});

test("reads the sample rate the model reports, and nothing else", () => {
  assert.equal(sampleRateOf("audio/pcm;rate=24000"), 24000);
  assert.equal(sampleRateOf("audio/pcm"), null);
  assert.equal(sampleRateOf(undefined), null);
});

test("voice tools include live lookup and canvas scaffolding beside the canvas tools", () => {
  assert.ok(VOICE_TOOLS.includes("lookup_web"));
  assert.ok(VOICE_TOOLS.includes("scaffold_canvas"));
  assert.ok(VOICE_TOOLS.includes("get_workspace_context"));
});

test("lookup kinds are the Context.dev slices the voice tool may ask for", () => {
  assert.deepEqual([...LOOKUP_KINDS], ["answer", "web", "companies", "people", "news"]);
  assert.equal(isLookupKind("answer"), true);
  assert.equal(isLookupKind("ultra"), false);
});
