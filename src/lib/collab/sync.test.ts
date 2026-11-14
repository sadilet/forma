import assert from "node:assert/strict";
import test from "node:test";
import type { FormaRoomEvent } from "./events.ts";
import { recordEvent, versionOf } from "./sync.ts";

function event(resource: FormaRoomEvent["resource"], blockId?: string): FormaRoomEvent {
  return {
    type: "RESOURCE_UPDATED",
    resource,
    actorId: "sam",
    actorName: "Sam",
    timestamp: 1,
    summary: "",
    ...(blockId === undefined ? {} : { blockId }),
  };
}

test("a global chat event refreshes the review chat whether the block id is blank or missing", () => {
  const blank = recordEvent({}, event("conversation", ""));
  const missing = recordEvent({}, event("conversation"));
  assert.equal(versionOf(blank, "conversation", ""), 1);
  assert.equal(versionOf(missing, "conversation", ""), 1);
  assert.equal(versionOf(blank, "conversation", "__market__"), 0);
});

test("an unrelated event does not reset a specification refresh", () => {
  let versions = recordEvent({}, event("specification", "shape:login"));
  versions = recordEvent(versions, event("conversation", "shape:login"));
  versions = recordEvent(versions, event("goal"));
  assert.equal(versionOf(versions, "specification", "shape:login"), 1);
});

test("two saves inside the same millisecond still count as two refreshes", () => {
  let versions = recordEvent({}, event("market"));
  versions = recordEvent(versions, event("market"));
  assert.equal(versionOf(versions, "market"), 2);
});
