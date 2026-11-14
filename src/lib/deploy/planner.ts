import type { CanvasSnapshot } from "../ai/schemas.ts";
import type { BuildPlan, PlanTask } from "./contract.ts";

// Turns the canvas into an ordered list of build tasks. This is deterministic on purpose: the same
// canvas always gives the same plan, so a plan can be read, reviewed, and compared before anything is built.
//
// Rules:
//  - One scaffold task, one data task for every entity and database, one task per service, one per screen,
//    and a final integration task.
//  - An arrow from a service or screen A to a service, screen, or database B means A needs B, so B comes first.
//  - Decisions are not built. They become constraints on the blocks they are connected to.
//  - Notes are product context for the whole plan.

type Block = CanvasSnapshot["blocks"][number];

const KIND_RANK: Record<string, number> = { scaffold: 0, data: 1, service: 2, screen: 3, integrate: 4 };
// Phrases that mark a block as unfinished. A bare "open" is not one: "open hours" is a normal feature.
const OPEN_WORDS =
  /\b(undecided|not specified|not defined|not decided|not verified|unclear|(?:is|are|still|remains?) open|open questions?)\b/i;

export function planFromSnapshot(canvas: CanvasSnapshot, goal = ""): BuildPlan {
  const warnings: string[] = [];
  const blocks = canvas.blocks;
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const edges = canvas.connections.filter(
    (edge) => byId.has(edge.fromId) && byId.has(edge.toId) && edge.fromId !== edge.toId,
  );

  if (blocks.length === 0) warnings.push("The canvas has no blocks, so there is nothing to build beyond the skeleton.");

  const globalConstraints: string[] = [];
  const constraintsFor = new Map<string, string[]>();
  for (const decision of blocks.filter((block) => block.kind === "decision")) {
    const text = `${decision.title}: ${decision.description || "no details"}`;
    const linked = new Set<string>();
    for (const edge of edges) {
      if (edge.fromId === decision.id) linked.add(edge.toId);
      if (edge.toId === decision.id) linked.add(edge.fromId);
    }
    let attached = false;
    for (const id of linked) {
      if (byId.get(id)?.kind === "decision" || byId.get(id)?.kind === "note") continue;
      constraintsFor.set(id, [...(constraintsFor.get(id) ?? []), text]);
      attached = true;
    }
    if (!attached) globalConstraints.push(text);
    if (OPEN_WORDS.test(decision.description)) {
      warnings.push(`Decision "${decision.title}" is still open. The builder must pick a default and record it.`);
    }
  }

  const notes = blocks.filter((block) => block.kind === "note");
  const summary = [goal.trim(), ...notes.map((note) => `${note.title}: ${note.description}`.trim())]
    .filter(Boolean)
    .join("\n");

  const tasks = new Map<string, PlanTask>();
  const taskOfBlock = new Map<string, string>();

  tasks.set("scaffold", {
    id: "scaffold",
    kind: "scaffold",
    title: "App skeleton",
    blockIds: [],
    dependsOn: [],
    goal: "Create the app skeleton: server, routes, database setup that migrates and seeds demo data on start, and a /api/health route.",
    constraints: globalConstraints,
    acceptance: ["The app starts with one command.", "GET /api/health returns 200.", "A first start creates demo data."],
  });

  const dataBlocks = blocks.filter((block) => block.kind === "entity" || block.kind === "database");
  if (dataBlocks.length > 0) {
    tasks.set("data", {
      id: "data",
      kind: "data",
      title: "Data model",
      blockIds: dataBlocks.map((block) => block.id),
      dependsOn: ["scaffold"],
      goal: `Create the data model for: ${dataBlocks.map((block) => block.title).join(", ")}.`,
      constraints: dataBlocks.flatMap((block) => constraintsFor.get(block.id) ?? []),
      acceptance: dataBlocks.map((block) => `${block.title}: ${block.description || "persisted"}`),
    });
    for (const block of dataBlocks) taskOfBlock.set(block.id, "data");
  }

  const codeBlocks = blocks.filter((block) => block.kind === "service" || block.kind === "screen");
  for (const block of codeBlocks) {
    const id = `${block.kind}:${block.id}`;
    taskOfBlock.set(block.id, id);
    if (OPEN_WORDS.test(block.description)) {
      warnings.push(`Block "${block.title}" has open questions. The builder must pick a default and record it.`);
    }
    const outgoing = edges.filter((edge) => edge.fromId === block.id);
    const incoming = edges.filter((edge) => edge.toId === block.id);
    tasks.set(id, {
      id,
      kind: block.kind as "service" | "screen",
      title: block.title,
      blockIds: [block.id],
      dependsOn: [],
      goal: `Build the ${block.kind} "${block.title}".`,
      constraints: [...(constraintsFor.get(block.id) ?? []), ...globalConstraints],
      acceptance: [
        block.description || `${block.title} works as the canvas describes.`,
        ...outgoing.map((edge) => `Uses ${edge.toTitle}${edge.label ? ` (${edge.label})` : ""}.`),
        ...incoming.map((edge) => `Is used by ${edge.fromTitle}${edge.label ? ` (${edge.label})` : ""}.`),
      ],
    });
  }

  // Dependencies: everything after the data task, then one dependency per arrow between code and data.
  const deps = new Map<string, Set<string>>();
  for (const task of tasks.values()) deps.set(task.id, new Set(task.dependsOn));
  for (const block of codeBlocks) {
    const id = taskOfBlock.get(block.id)!;
    deps.get(id)!.add(tasks.has("data") ? "data" : "scaffold");
  }
  for (const edge of edges) {
    const from = byId.get(edge.fromId)!;
    const to = byId.get(edge.toId)!;
    if (from.kind !== "service" && from.kind !== "screen") continue;
    if (to.kind !== "service" && to.kind !== "screen" && to.kind !== "database") continue;
    const fromTask = taskOfBlock.get(from.id)!;
    const toTask = taskOfBlock.get(to.id);
    if (toTask && toTask !== fromTask) deps.get(fromTask)!.add(toTask);
  }

  const integrateDeps = [...tasks.keys()];
  tasks.set("integrate", {
    id: "integrate",
    kind: "integrate",
    title: "Integration and smoke test",
    blockIds: [],
    dependsOn: [],
    goal: "Connect the pieces, run the main flow end to end, and make sure the container builds and starts.",
    constraints: globalConstraints,
    acceptance: ["The main flow works from the first screen to the stored result.", "GET /api/health returns 200."],
  });
  deps.set("integrate", new Set(integrateDeps));

  // sortTasks removes dependencies it had to cut to break a cycle, so what is left always points backwards.
  const order = sortTasks(tasks, deps, blocks, warnings);
  const ordered = order.map((id) => ({
    ...tasks.get(id)!,
    dependsOn: order.filter((other) => deps.get(id)!.has(other)),
  }));

  return { version: 1, summary, tasks: ordered, warnings };
}

function sortTasks(
  tasks: Map<string, PlanTask>,
  deps: Map<string, Set<string>>,
  blocks: Block[],
  warnings: string[],
): string[] {
  const position = new Map<string, number>();
  position.set("scaffold", 0);
  position.set("data", 1);
  blocks.forEach((block, index) => position.set(`${block.kind}:${block.id}`, 10 + index));
  position.set("integrate", Number.MAX_SAFE_INTEGER);

  const rank = (id: string) => KIND_RANK[tasks.get(id)!.kind];
  const compare = (a: string, b: string) => rank(a) - rank(b) || (position.get(a) ?? 0) - (position.get(b) ?? 0);

  const remaining = new Set(tasks.keys());
  const openDeps = (id: string) => [...deps.get(id)!].filter((dep) => remaining.has(dep)).length;
  const result: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => [...deps.get(id)!].every((dep) => !remaining.has(dep)));
    if (ready.length > 0) {
      ready.sort(compare);
      const next = ready[0];
      result.push(next);
      remaining.delete(next);
      continue;
    }
    // A cycle. Take the task with the fewest open dependencies, forget those arrows, and say so.
    const stuck = [...remaining].sort((a, b) => openDeps(a) - openDeps(b) || compare(a, b))[0];
    const cut = [...deps.get(stuck)!].filter((dep) => remaining.has(dep));
    warnings.push(
      `"${tasks.get(stuck)!.title}" and ${cut.map((id) => `"${tasks.get(id)!.title}"`).join(", ")} depend on each other. ` +
        `They are built in canvas order.`,
    );
    for (const dep of cut) deps.get(stuck)!.delete(dep);
  }
  return result;
}
