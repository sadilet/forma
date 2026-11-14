import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAndSet,
  draftValue,
  editDraft,
  keepEdits,
  markSaved,
  receiveRemote,
  startDraft,
  takeIncoming,
} from "./draft.ts";

test("a remote save keeps an unsaved draft and offers the saved version", () => {
  const draft = editDraft(startDraft({ value: "alex base", version: 1 }), "alex typing");
  const next = receiveRemote(draft, { value: "sam saved", version: 2 });
  assert.equal(draftValue(next), "alex typing");
  assert.deepEqual(next.incoming, { value: "sam saved", version: 2 });
});

test("a remote save replaces a clean draft", () => {
  const next = receiveRemote(startDraft({ value: "old", version: 1 }), { value: "new", version: 2 });
  assert.equal(draftValue(next), "new");
  assert.equal(next.incoming, null);
});

test("a held draft without edits still offers instead of replacing", () => {
  const next = receiveRemote(startDraft({ value: "old", version: null }), { value: "new", version: null }, true);
  assert.equal(draftValue(next), "old");
  assert.equal(next.incoming?.value, "new");
});

test("a late read older than the saved version is ignored", () => {
  const draft = startDraft({ value: "just saved", version: 5 });
  assert.equal(receiveRemote(draft, { value: "stale read", version: 4 }), draft);
});

test("keeping my edits rebases them onto the incoming version", () => {
  const draft = receiveRemote(editDraft(startDraft({ value: "a", version: 1 }), "mine"), { value: "theirs", version: 2 });
  const kept = keepEdits(draft);
  assert.equal(draftValue(kept), "mine");
  assert.equal(kept.saved.version, 2);
  assert.equal(kept.incoming, null);
  assert.equal(draftValue(takeIncoming(draft)), "theirs");
});

test("a save clears only the edits that were sent", () => {
  const sent = editDraft(startDraft({ value: "a", version: 1 }), "sent");
  const typedMore = editDraft(sent, "typed after send");
  assert.equal(markSaved(sent, { value: "sent", version: 2 }, "sent").edits, null);
  assert.equal(markSaved(typedMore, { value: "sent", version: 2 }, "sent").edits, "typed after send");
});

test("a goal save over a teammate's newer goal is a conflict", () => {
  assert.equal(compareAndSet("sam goal", "alex base", "alex goal"), "conflict");
  assert.equal(compareAndSet("alex base", "alex base", "alex goal"), "write");
  assert.equal(compareAndSet("same", "older", "same"), "unchanged");
  assert.equal(compareAndSet("sam goal", undefined, "alex goal"), "write");
});
