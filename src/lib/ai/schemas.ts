import { z } from "zod";
import { BLOCK_KINDS } from "@/lib/canvas/kinds";

export const specificationSchema = z.object({
  purpose: z.string(),
  description: z.string(),
  functionalRequirements: z.array(z.string()),
  businessRules: z.array(z.string()),
  dependencies: z.array(z.string()),
  edgeCases: z.array(z.string()),
  openQuestions: z.array(z.string()),
  architecturalDecisions: z.array(z.string()),
});

export type Specification = z.infer<typeof specificationSchema>;

export function emptySpecification(): Specification {
  return {
    purpose: "",
    description: "",
    functionalRequirements: [],
    businessRules: [],
    dependencies: [],
    edgeCases: [],
    openQuestions: [],
    architecturalDecisions: [],
  };
}

export const canvasBlockSchema = z.object({
  id: z.string(),
  kind: z.enum(BLOCK_KINDS),
  title: z.string(),
  description: z.string(),
});

export const canvasConnectionSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  fromTitle: z.string(),
  toTitle: z.string(),
  label: z.string(),
});

export const canvasSketchSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string(),
});

export const canvasSnapshotSchema = z.object({
  blocks: z.array(canvasBlockSchema).max(80),
  connections: z.array(canvasConnectionSchema).max(160),
  sketches: z.array(canvasSketchSchema).max(40),
});

export type CanvasSnapshot = z.infer<typeof canvasSnapshotSchema>;

export const findingSchema = z.object({
  title: z.string(),
  description: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  category: z.enum([
    "missing-requirement",
    "incomplete-flow",
    "ambiguous-logic",
    "missing-component",
    "architecture",
    "discussion",
  ]),
  question: z.string(),
  relatedBlockId: z.string().nullable(),
  relatedBlockTitle: z.string().nullable(),
});

export function clip<Item extends z.ZodType>(item: Item, limit: number) {
  return z.preprocess(
    (value: unknown) => (Array.isArray(value) ? value.slice(0, limit) : value),
    z.array(item),
  );
}

export const canvasProposalSchema = z.object({
  action: z.enum(["update", "create"]),
  blockId: z.string().nullable(),
  kind: z.enum(BLOCK_KINDS),
  title: z.string(),
  description: z.string(),
  reason: z.string(),
  citationIds: z.array(z.string()),
});

export type CanvasProposal = z.infer<typeof canvasProposalSchema>;

export const analysisSchema = z.object({
  summary: z.string(),
  findings: clip(findingSchema, 8),
  canvasProposals: clip(canvasProposalSchema, 4),
});

export type Analysis = z.infer<typeof analysisSchema>;
export type Finding = z.infer<typeof findingSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.number(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const SPEC_FIELDS: { key: keyof Specification; label: string; list: boolean }[] = [
  { key: "purpose", label: "Purpose", list: false },
  { key: "description", label: "Description", list: false },
  { key: "functionalRequirements", label: "Functional requirements", list: true },
  { key: "businessRules", label: "Business rules", list: true },
  { key: "dependencies", label: "Dependencies", list: true },
  { key: "edgeCases", label: "Edge cases", list: true },
  { key: "openQuestions", label: "Open questions", list: true },
  { key: "architecturalDecisions", label: "Architectural decisions", list: true },
];
