import "server-only";

import type { Architect } from "@/lib/ai/provider";
import { normalizeScaffold, scaffoldPlanSchema, type ScaffoldPlan } from "@/lib/canvas/scaffold-schema";

// Ask the architect for a small first canvas: screens, services, data, and the links between them.
// Kept short so a blank workspace can fill in under a few seconds.

export async function draftScaffold(input: {
  architect: Architect;
  brief: string;
  projectName: string;
  currentGoal: string;
}): Promise<ScaffoldPlan> {
  const brief = input.brief.trim().slice(0, 2000);
  const drafted = await input.architect.completeJson({
    schema: scaffoldPlanSchema,
    schemaName: "canvas_scaffold",
    temperature: 0.35,
    system: [
      "You are Forma's product architect. Draft the first version of a product canvas from a short brief.",
      "Return 6 to 12 components. Prefer screens, services, databases, entities, and one or two open decisions.",
      "Every block needs a concrete title and a one or two sentence description of what it does in this product.",
      "Use column 0 for people/entities, 1 for screens, 2 for services and decisions, 3 for databases.",
      "Link blocks with short verb labels (books, pays, stores, notifies). Do not invent competitors or prices.",
      "goal is a crisp product goal for the workspace. summary is what you tell the team out loud about the draft.",
      "Keys are short snake_case ids used only inside this plan.",
    ].join(" "),
    prompt: [
      `Project name: ${input.projectName}`,
      `Current goal: ${input.currentGoal.trim() || "Not stated."}`,
      "",
      "Brief from the team:",
      brief,
    ].join("\n"),
  });
  const plan = normalizeScaffold(drafted);
  if (plan.blocks.length < 3) {
    throw new Error("The draft did not include enough components to start from.");
  }
  return plan;
}
