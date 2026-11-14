import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasSnapshot } from "../ai/schemas.ts";
import { planFromSnapshot } from "./planner.ts";

type Kind = CanvasSnapshot["blocks"][number]["kind"];

// The SlotGuard canvas from docs/demo_product.md: 16 blocks and 19 arrows.
const BLOCKS: [string, Kind, string, string][] = [
  ["intent", "note", "Product intent", "Salons lose money on no-shows."],
  ["pricing", "decision", "Pricing model", "Undecided: flat SaaS or a share of deposits."],
  ["rules", "decision", "Deposit rules", "Undecided: amount and cancel cutoff."],
  ["provider", "decision", "Payments provider", "Undecided: Stripe or another."],
  ["booking", "screen", "Public booking page", "Client picks a service and a time."],
  ["checkout", "screen", "Deposit checkout", "Collects the deposit."],
  ["cancel", "screen", "Cancel / reschedule", "Client cancels."],
  ["dashboard", "screen", "Owner dashboard", "Lists appointments with deposit status."],
  ["services", "screen", "Services & availability", "Owner defines services and open hours."],
  ["engine", "service", "Booking engine", "Creates appointments. Concurrency rules are open."],
  ["deposits", "service", "Deposit & refunds", "Handles capture, refund, and forfeit."],
  ["notifications", "service", "Notifications", "Sends confirmations."],
  ["store", "database", "SlotGuard store", "Persists everything."],
  ["owner", "entity", "Owner", "The paying customer."],
  ["client", "entity", "Client", "Booker."],
  ["appointment", "entity", "Appointment", "Service, time, client, deposit state."],
];

const LINKS: [string, string, string][] = [
  ["client", "booking", "books"],
  ["booking", "checkout", "continues"],
  ["intent", "pricing", "frames"],
  ["intent", "rules", "frames"],
  ["pricing", "dashboard", "shapes plan"],
  ["rules", "checkout", "shown in"],
  ["rules", "cancel", "applied in"],
  ["rules", "deposits", "governs"],
  ["provider", "deposits", "powers"],
  ["checkout", "deposits", "pays"],
  ["checkout", "engine", "reserves"],
  ["cancel", "deposits", "refunds"],
  ["engine", "store", "writes"],
  ["deposits", "store", "audits"],
  ["dashboard", "store", "reads"],
  ["services", "engine", "offers"],
  ["engine", "notifications", "events"],
  ["owner", "dashboard", "uses"],
  ["appointment", "store", "stored in"],
];

function slotguard(): CanvasSnapshot {
  const title = new Map(BLOCKS.map(([id, , name]) => [id, name]));
  return {
    blocks: BLOCKS.map(([id, kind, name, description]) => ({ id: `shape:${id}`, kind, title: name, description })),
    connections: LINKS.map(([from, to, label]) => ({
      id: `arrow:${from}-${to}`,
      fromId: `shape:${from}`,
      toId: `shape:${to}`,
      fromTitle: title.get(from)!,
      toTitle: title.get(to)!,
      label,
    })),
    sketches: [],
  };
}

function taskFor(plan: ReturnType<typeof planFromSnapshot>, blockId: string) {
  const task = plan.tasks.find((candidate) => candidate.blockIds.includes(`shape:${blockId}`));
  assert.ok(task, `no task for ${blockId}`);
  return task;
}

test("the SlotGuard canvas becomes one task per service and screen plus skeleton, data, and integration", () => {
  const plan = planFromSnapshot(slotguard(), "SlotGuard cuts no-show losses.");
  assert.equal(plan.tasks.length, 11);
  assert.equal(plan.tasks[0].id, "scaffold");
  assert.equal(plan.tasks[1].id, "data");
  assert.equal(plan.tasks.at(-1)?.id, "integrate");
  assert.deepEqual(plan.tasks.filter((task) => task.kind === "service").length, 3);
  assert.deepEqual(plan.tasks.filter((task) => task.kind === "screen").length, 5);
  assert.deepEqual([...taskFor(plan, "store").blockIds].sort(), [
    "shape:appointment",
    "shape:client",
    "shape:owner",
    "shape:store",
  ]);
});

test("every task only depends on tasks that come before it", () => {
  const plan = planFromSnapshot(slotguard());
  const seen = new Set<string>();
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) assert.ok(seen.has(dep), `${task.id} needs ${dep} first`);
    seen.add(task.id);
  }
});

test("a block is built after the services and data it uses", () => {
  const plan = planFromSnapshot(slotguard());
  const index = (blockId: string) => plan.tasks.indexOf(taskFor(plan, blockId));
  assert.ok(index("notifications") < index("engine"));
  assert.ok(index("engine") < index("checkout"));
  assert.ok(index("deposits") < index("checkout"));
  assert.ok(index("deposits") < index("cancel"));
  assert.ok(index("store") < index("engine"));
  assert.ok(taskFor(plan, "checkout").dependsOn.includes(taskFor(plan, "deposits").id));
});

test("decisions become constraints on the blocks they are connected to", () => {
  const plan = planFromSnapshot(slotguard());
  const deposits = taskFor(plan, "deposits").constraints.join("\n");
  assert.match(deposits, /Deposit rules/);
  assert.match(deposits, /Payments provider/);
  assert.match(taskFor(plan, "dashboard").constraints.join("\n"), /Pricing model/);
  assert.equal(plan.tasks.some((task) => task.blockIds.includes("shape:pricing")), false);
});

test("open decisions and unfinished blocks are reported, normal wording is not", () => {
  const plan = planFromSnapshot(slotguard());
  const text = plan.warnings.join("\n");
  assert.match(text, /Pricing model/);
  assert.match(text, /Payments provider/);
  assert.match(text, /Booking engine/);
  assert.doesNotMatch(text, /Services & availability/);
});

test("the summary joins the goal and the notes", () => {
  const plan = planFromSnapshot(slotguard(), "SlotGuard cuts no-show losses.");
  assert.match(plan.summary, /SlotGuard cuts no-show losses\./);
  assert.match(plan.summary, /Product intent/);
});

test("the same canvas always gives the same plan", () => {
  assert.deepEqual(planFromSnapshot(slotguard(), "goal"), planFromSnapshot(slotguard(), "goal"));
});

test("two services that use each other still get a valid order and a warning", () => {
  const plan = planFromSnapshot({
    blocks: [
      { id: "a", kind: "service", title: "Alpha", description: "" },
      { id: "b", kind: "service", title: "Beta", description: "" },
    ],
    connections: [
      { id: "1", fromId: "a", toId: "b", fromTitle: "Alpha", toTitle: "Beta", label: "calls" },
      { id: "2", fromId: "b", toId: "a", fromTitle: "Beta", toTitle: "Alpha", label: "calls" },
    ],
    sketches: [],
  });
  assert.equal(plan.tasks.length, 4);
  assert.match(plan.warnings.join("\n"), /depend on each other/);
  const seen = new Set<string>();
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) assert.ok(seen.has(dep));
    seen.add(task.id);
  }
});

test("an empty canvas gives the skeleton and integration only, with a warning", () => {
  const plan = planFromSnapshot({ blocks: [], connections: [], sketches: [] });
  assert.deepEqual(
    plan.tasks.map((task) => task.id),
    ["scaffold", "integrate"],
  );
  assert.match(plan.warnings[0], /no blocks/);
});

test("arrows to blocks that are not on the canvas are ignored", () => {
  const plan = planFromSnapshot({
    blocks: [{ id: "a", kind: "screen", title: "Home", description: "" }],
    connections: [{ id: "1", fromId: "a", toId: "ghost", fromTitle: "Home", toTitle: "Ghost", label: "" }],
    sketches: [],
  });
  assert.deepEqual(
    plan.tasks.map((task) => task.id),
    ["scaffold", "screen:a", "integrate"],
  );
});
