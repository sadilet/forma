import assert from "node:assert/strict";
import test from "node:test";
import { mergeMessages, type MergeableMessage } from "./messages.ts";

function message(id: string, content: string, createdAt: number): MergeableMessage {
  return { id, role: "user", content, createdAt };
}

test("merge keeps both sides when message ids differ", () => {
  const merged = mergeMessages([message("a", "from alex", 1)], [message("b", "from sam", 2)]);
  assert.deepEqual(
    merged.map((item) => item.id),
    ["a", "b"],
  );
});

test("merge prefers the longer copy of the same message", () => {
  const merged = mergeMessages(
    [message("a", "partial", 1)],
    [message("a", "partial answer finished", 1)],
  );
  assert.equal(merged[0]?.content, "partial answer finished");
});

test("merge keeps the newest messages when the thread exceeds the cap", () => {
  const current = Array.from({ length: 40 }, (_, index) => message(`old-${index}`, "x", index));
  const merged = mergeMessages(current, [message("new", "latest", 100)], 40);
  assert.equal(merged.length, 40);
  assert.equal(merged.at(-1)?.id, "new");
  assert.equal(merged.some((item) => item.id === "old-0"), false);
});
