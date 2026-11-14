import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { describeChanges } from "./diff.ts";

const base: CanvasSnapshot = {
  blocks: [
    { id: "a", kind: "screen", title: "Booking page", description: "Client picks a time." },
    { id: "b", kind: "decision", title: "Deposit rules", description: "20% of the price." },
    { id: "c", kind: "database", title: "Store", description: "Persists everything." },
  ],
  connections: [{ id: "1", fromId: "a", toId: "c", fromTitle: "Booking page", toTitle: "Store", label: "writes" }],
  sketches: [{ id: "s1", type: "text", text: "remember the logo" }],
};

const state = (snapshot: CanvasSnapshot, goal = "Cut no-shows.") => ({ snapshot, goal });

test("nothing changed means no changes", () => {
  assert.deepEqual(describeChanges(state(base), state(structuredClone(base))), []);
});

test("moving blocks around changes nothing, because positions are not in the snapshot", () => {
  const same = structuredClone(base);
  same.blocks.reverse();
  assert.deepEqual(describeChanges(state(base), state(same)), []);
});

test("a changed decision is described with the old and the new text", () => {
  const next = structuredClone(base);
  next.blocks[1].description = "30% of the price, refundable until 48 hours before.";
  const lines = describeChanges(state(base), state(next));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Changed decision "Deposit rules"/);
  assert.match(lines[0], /was "20% of the price\." and is now "30% of the price/);
});

test("added and removed blocks, arrows and sketches are all reported", () => {
  const next = structuredClone(base);
  next.blocks.push({ id: "d", kind: "service", title: "Reminders", description: "Texts clients the day before." });
  next.blocks = next.blocks.filter((block) => block.id !== "b");
  next.connections.push({ id: "2", fromId: "d", toId: "a", fromTitle: "Reminders", toTitle: "Booking page", label: "" });
  next.connections = next.connections.filter((edge) => edge.id !== "1");
  next.sketches = [];
  const text = describeChanges(state(base), state(next)).join("\n");
  assert.match(text, /Added service "Reminders": Texts clients the day before\./);
  assert.match(text, /Removed decision "Deposit rules"\./);
  assert.match(text, /Added arrow "Reminders" to "Booking page"\./);
  assert.match(text, /Removed arrow "Booking page" to "Store" \(writes\)\./);
  assert.match(text, /Removed sketch text: "remember the logo"\./);
});

test("a rename and a kind change are reported", () => {
  const next = structuredClone(base);
  next.blocks[0].title = "Public booking page";
  next.blocks[0].kind = "service";
  const [line] = describeChanges(state(base), state(next));
  assert.match(line, /now a service \(was a screen\)/);
  assert.match(line, /renamed from "Booking page"/);
});

test("a changed goal counts, and long text is shortened", () => {
  const long = "x".repeat(2000);
  const [line] = describeChanges(state(base, "Old goal"), state(base, long));
  assert.match(line, /The product goal changed/);
  assert.ok(line.length < 700);
});

test("whitespace-only edits are not changes", () => {
  const next = structuredClone(base);
  next.blocks[0].description = "  Client picks a time.  ";
  assert.deepEqual(describeChanges(state(base), state(next, "  Cut no-shows. ")), []);
});
