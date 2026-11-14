import assert from "node:assert/strict";
import test from "node:test";
import { layoutScaffold, normalizeScaffold, type ScaffoldPlan } from "./scaffold-schema.ts";

const plan: ScaffoldPlan = {
  goal: "Help barbers take deposits on bookings",
  summary: "A first cut of booking, checkout, and the store.",
  blocks: [
    { key: "client", kind: "entity", title: "Client", description: "A guest with a phone number.", column: 0, row: 0 },
    { key: "booking", kind: "screen", title: "Booking page", description: "Public booking.", column: 1, row: 0 },
    { key: "engine", kind: "service", title: "Booking engine", description: "Reserves slots.", column: 2, row: 0 },
    { key: "store", kind: "database", title: "Store", description: "Appointments and clients.", column: 3, row: 0 },
    { key: "dup", kind: "note", title: "Dup", description: "Should drop.", column: 1, row: 1 },
  ],
  links: [
    { fromKey: "client", toKey: "booking", label: "books" },
    { fromKey: "booking", toKey: "engine", label: "submits" },
    { fromKey: "engine", toKey: "store", label: "writes" },
    { fromKey: "missing", toKey: "store", label: "bad" },
    { fromKey: "store", toKey: "store", label: "loop" },
  ],
};

test("normalize drops bad links and keeps the first copy of a key", () => {
  const withDup = {
    ...plan,
    blocks: [...plan.blocks, { ...plan.blocks[0], title: "Other client" }],
  };
  const next = normalizeScaffold(withDup);
  assert.equal(next.blocks.filter((block) => block.key === "client").length, 1);
  assert.deepEqual(
    next.links.map((link) => link.label),
    ["books", "submits", "writes"],
  );
});

test("layout places columns left to right and rows top to bottom", () => {
  const spots = layoutScaffold(plan.blocks.slice(0, 4));
  assert.ok(spots.client.x < spots.booking.x);
  assert.ok(spots.booking.x < spots.engine.x);
  assert.ok(spots.engine.x < spots.store.x);
  assert.equal(spots.client.y, spots.booking.y);
});
