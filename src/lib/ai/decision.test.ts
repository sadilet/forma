import assert from "node:assert/strict";
import test from "node:test";
import {
  FRESH_RUN_THRESHOLD,
  decide,
  decisionInput,
  decisionQuestions,
  heuristicDecision,
  looksLikeScaffoldBrief,
  readDecision,
} from "./decision.ts";

const input = { question: "Who are our competitors?", goal: "Salon booking", blockTitles: ["Checkout"] };

function answers(probabilities: Record<string, number>, noul = 0.1, scaffold = 0.1) {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return {
    tab: { type: "choice", choice, probabilities, confidence: probabilities[choice] },
    fresh_run: { type: "noul", noul, confidence: Math.max(noul, 1 - noul) },
    scaffold_canvas: { type: "noul", noul: scaffold, confidence: Math.max(scaffold, 1 - scaffold) },
  };
}

test("asks one choice question with all four tabs and yes/no questions for fresh runs and scaffolding", () => {
  const questions = decisionQuestions();
  assert.equal(questions.tab.type, "choice");
  assert.deepEqual(Object.keys(questions.tab.criteria).sort(), ["engineering", "leads", "market", "review"]);
  assert.equal(questions.fresh_run.type, "noul");
  assert.equal(questions.scaffold_canvas.type, "noul");
});

test("sends the question, goal, component titles, and whether the canvas is empty", () => {
  const parsed = JSON.parse(decisionInput(input));
  assert.equal(parsed.question, "Who are our competitors?");
  assert.equal(parsed.projectGoal, "Salon booking");
  assert.deepEqual(parsed.canvasComponents, ["Checkout"]);
  assert.equal(parsed.canvasEmpty, false);
  assert.equal(JSON.parse(decisionInput({ ...input, blockTitles: [], canvasEmpty: true })).canvasEmpty, true);
});

test("picks the tab with the highest probability", () => {
  const decision = readDecision(answers({ engineering: 0.05, leads: 0.1, market: 0.8, review: 0.05 }));
  assert.equal(decision?.tab, "market");
  assert.equal(decision?.label, "Flagged as Market");
  assert.equal(decision?.confidence, 0.8);
});

test("reads the winner from probabilities even when the choice field is wrong", () => {
  const decision = readDecision({
    tab: { type: "choice", choice: "review", probabilities: { engineering: 0.7, leads: 0.1, market: 0.1, review: 0.1 } },
  });
  assert.equal(decision?.tab, "engineering");
});

test("runs a fresh pipeline only at or above the threshold", () => {
  const base = { engineering: 0.1, leads: 0.1, market: 0.7, review: 0.1 };
  assert.equal(readDecision(answers(base, FRESH_RUN_THRESHOLD))?.shouldRunPipeline, true);
  assert.equal(readDecision(answers(base, FRESH_RUN_THRESHOLD - 0.01))?.shouldRunPipeline, false);
});

test("scaffolds the canvas only at or above the threshold", () => {
  const base = { engineering: 0.1, leads: 0.1, market: 0.1, review: 0.7 };
  assert.equal(readDecision(answers(base, 0.1, FRESH_RUN_THRESHOLD))?.shouldScaffold, true);
  assert.equal(readDecision(answers(base, 0.1, FRESH_RUN_THRESHOLD - 0.01))?.shouldScaffold, false);
});

test("returns nothing when the answer is missing or the wrong type", () => {
  assert.equal(readDecision(undefined), null);
  assert.equal(readDecision({ tab: { type: "noul" } }), null);
});

test("uses the Decisions API result when it answers", async () => {
  const result = await decide({
    input,
    geminiKey: "key",
    evaluate: async () => answers({ engineering: 0.02, leads: 0.9, market: 0.04, review: 0.04 }),
  });
  assert.equal(result.source, "gemini-decision");
  assert.equal(result.decision.tab, "leads");
});

test("falls back to the architect model when the Decisions call fails", async () => {
  const result = await decide({
    input,
    geminiKey: "key",
    evaluate: async () => {
      throw new Error("unavailable");
    },
    architect: { completeJson: async () => ({ tab: "engineering", shouldRunPipeline: true, shouldScaffold: false }) as never },
  });
  assert.equal(result.source, "architect");
  assert.equal(result.decision.tab, "engineering");
  assert.equal(result.decision.shouldRunPipeline, true);
});

test("uses the architect model when there is no Gemini key", async () => {
  const result = await decide({
    input,
    architect: { completeJson: async () => ({ tab: "market", shouldRunPipeline: false, shouldScaffold: true }) as never },
  });
  assert.equal(result.source, "architect");
});

test("guesses from keywords only when no model answers, and says so", async () => {
  const result = await decide({ input: { ...input, question: "Is our OAuth setup deprecated?" } });
  assert.equal(result.source, "fallback");
  assert.equal(result.decision.tab, "engineering");
  assert.equal(heuristicDecision("What happens when a booking is cancelled twice?").tab, "review");
});

test("an empty-canvas product brief scaffolds in the heuristic fallback", () => {
  const decision = heuristicDecision("I want a booking app for barbers", true);
  assert.equal(decision.shouldScaffold, true);
  assert.equal(decision.tab, "review");
  assert.equal(heuristicDecision("Who are our competitors?", false).shouldScaffold, false);
});

test("scaffold briefs are recognised for voice and empty-canvas routing", () => {
  assert.equal(looksLikeScaffoldBrief("I want a booking app for barbers"), true);
  assert.equal(looksLikeScaffoldBrief("Who are our competitors?"), false);
  assert.equal(looksLikeScaffoldBrief("short"), false);
});
