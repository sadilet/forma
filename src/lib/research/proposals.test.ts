import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasProposal, CanvasSnapshot } from "../ai/schemas.ts";
import { acceptProposals, landWedge } from "./proposals.ts";

const canvas: CanvasSnapshot = {
  blocks: [
    { id: "shape:pricing", kind: "decision", title: "Pricing model", description: "Undecided." },
    { id: "shape:screen", kind: "screen", title: "Booking page", description: "Pick a time." },
  ],
  connections: [],
  sketches: [],
};

function proposal(patch: Partial<CanvasProposal>): CanvasProposal {
  return {
    action: "update",
    blockId: "shape:pricing",
    kind: "decision",
    title: "Pricing model",
    description: "Flat SaaS per location.",
    reason: "Owners resist another heavy suite.",
    citationIds: ["cit_1", "cit_missing"],
    ...patch,
  };
}

test("a conclusion update keeps a real decision block and drops unknown citations", () => {
  const accepted = acceptProposals({
    proposals: [proposal({}), proposal({ blockId: "shape:screen", description: "Change the screen." })],
    canvas,
    citationIds: new Set(["cit_1"]),
    scope: "conclusions",
  });
  assert.equal(accepted.length, 1);
  assert.deepEqual(accepted[0]?.citationIds, ["cit_1"]);
  assert.equal(accepted[0]?.blockId, "shape:pricing");
});

test("a component discussion can update only the focused block", () => {
  const accepted = acceptProposals({
    proposals: [
      proposal({
        blockId: "shape:pricing",
        kind: "screen",
        title: "Wrong",
        description: "Show the deposit before payment.",
      }),
    ],
    canvas,
    citationIds: new Set(),
    scope: "block",
    focusBlockId: "shape:screen",
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.blockId, "shape:screen");
  assert.equal(accepted[0]?.kind, "screen");
  assert.equal(accepted[0]?.title, "Booking page");
});

test("an empty proposal list lands the wedge on the closest decision", () => {
  const local: CanvasSnapshot = {
    ...canvas,
    blocks: [
      ...canvas.blocks,
      {
        id: "shape:vendor",
        kind: "decision",
        title: "Build or buy transcription",
        description: "Vendor API or an own model.",
      },
    ],
  };
  const accepted = landWedge({
    proposals: [],
    canvas: local,
    citationIds: new Set(["cit_1"]),
    wedge: "Buy transcription for Finnish meetings instead of building a model.",
    wedgeCitationIds: ["cit_1", "cit_missing"],
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.blockId, "shape:vendor");
  assert.equal(accepted[0]?.title, "Build or buy transcription");
  assert.deepEqual(accepted[0]?.citationIds, ["cit_1"]);
});
