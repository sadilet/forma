import type { CanvasSnapshot, Specification } from "@/lib/ai/schemas";
import { BLOCK_META, type BlockKind } from "@/lib/canvas/kinds";

export function describeCanvas(snapshot: CanvasSnapshot) {
  const blocks =
    snapshot.blocks.length === 0
      ? "None."
      : snapshot.blocks
          .map((block) => {
            const meta = BLOCK_META[block.kind];
            const description = block.description.trim() || "No description.";
            return `- ${block.title} (${meta.label}) [${block.id}]\n  ${description}`;
          })
          .join("\n");

  const connections =
    snapshot.connections.length === 0
      ? "None."
      : snapshot.connections
          .map((connection) => {
            const label = connection.label.trim() ? ` — ${connection.label.trim()}` : "";
            return `- ${connection.fromTitle} → ${connection.toTitle}${label}\n  ${connection.fromId} → ${connection.toId}`;
          })
          .join("\n");

  const sketches =
    snapshot.sketches.length === 0
      ? "None."
      : snapshot.sketches
          .map((sketch) => `- ${sketch.type}: ${sketch.text.trim() || "unlabeled"}`)
          .join("\n");

  return [`Components`, blocks, ``, `Connections`, connections, ``, `Sketches`, sketches].join("\n");
}

export function describeSpecification(specification: Specification | null) {
  if (!specification) return "No specification has been saved yet.";
  const lines = [
    `Purpose: ${specification.purpose || "—"}`,
    `Description: ${specification.description || "—"}`,
    `Functional requirements: ${formatList(specification.functionalRequirements)}`,
    `Business rules: ${formatList(specification.businessRules)}`,
    `Dependencies: ${formatList(specification.dependencies)}`,
    `Edge cases: ${formatList(specification.edgeCases)}`,
    `Open questions: ${formatList(specification.openQuestions)}`,
    `Architectural decisions: ${formatList(specification.architecturalDecisions)}`,
  ];
  return lines.join("\n");
}

function formatList(items: string[]) {
  if (items.length === 0) return "—";
  return items.map((item) => item.trim()).filter(Boolean).join("; ");
}

export function suggestionsFor(kind: BlockKind | "global") {
  switch (kind) {
    case "screen":
      return [
        "What should this screen do when its data is missing or fails to load?",
        "Which action is primary, and what should be hard to do by accident?",
        "What does someone need to understand in the first glance?",
      ];
    case "service":
      return [
        "What happens when this operation fails halfway through?",
        "Which events should this service emit, and who listens?",
        "What has to be idempotent if the caller retries?",
      ];
    case "database":
      return [
        "Which entities live here, and what uniquely identifies them?",
        "What must stay consistent if two people write at the same time?",
        "What is the recovery expectation if this store is unavailable?",
      ];
    case "entity":
      return [
        "Which fields are required, and which can change later?",
        "Who is allowed to create or modify this?",
        "What happens to related data when this is removed?",
      ];
    case "decision":
      return [
        "What are the real options, and what does each one cost?",
        "Which failure case does this decision leave unresolved?",
        "What would make this decision wrong in six months?",
      ];
    case "note":
      return [
        "What requirement is hiding in this note?",
        "Which component should own this behavior?",
        "What is still too vague to build?",
      ];    default:
      return [
        "Which user flow is still incomplete?",
        "Where is failure behavior unspecified?",
        "Which component should the team specify next?",
      ];
  }
}
