import { Type, type FunctionDeclaration } from "@google/genai";
import { CONTEXT_SCOPES, LOOKUP_KINDS } from "./protocol.ts";

// Tool declarations for the Live session. The relay registers them; the browser runs them.

export const VOICE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_canvas_details",
    description:
      "Read the live canvas: every component with its title and description, the arrows between components, the current selection, and each selected or listed component's saved specification. Call this before describing specifics of the design.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_workspace_context",
    description:
      "Pull saved workspace knowledge and past discussions: the product review, market research, buyer leads, engineering docs and standards, component specifications, and earlier conversations. Use it when the person asks about something that was researched or discussed before.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        scope: {
          type: Type.STRING,
          enum: [...CONTEXT_SCOPES],
          description: "Which slice to read. Use 'all' only when the question spans several areas.",
        },
        blockId: {
          type: Type.STRING,
          description: "A canvas component id, required when scope is 'component'.",
        },
      },
      required: ["scope"],
    },
  },
  {
    name: "lookup_web",
    description:
      "Look something up on the live web through Context.dev. Use it when the person asks for current facts that are not already in a saved Review, Market, Leads, or Engineering pack: competitors, prices, people, news, or a short researched answer. Prefer get_workspace_context first when the topic was already researched. Keep questions short.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description: "The short research question to look up right now.",
        },
        kind: {
          type: Type.STRING,
          enum: [...LOOKUP_KINDS],
          description:
            "answer = short researched reply (default). web = page hits. companies = company search. people = buyer/person search. news = recent articles.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "scaffold_canvas",
    description:
      "Draft the first product structure onto the canvas from a short brief (for example 'a booking app for barbers'). Use when the canvas is empty or the person asks to start over. Set replace to true only when they clearly ask to wipe the current canvas.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        brief: {
          type: Type.STRING,
          description: "What they want to build, in one or two sentences.",
        },
        replace: {
          type: Type.BOOLEAN,
          description: "When true, clear the current page before placing the new draft.",
        },
      },
      required: ["brief"],
    },
  },
  {
    name: "navigate_workspace",
    description:
      "Move the person's screen while you talk: open the Review, Market, Leads, or Engineering tab of the Architect, or select and zoom to a canvas component by id.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        tab: { type: Type.STRING, enum: ["review", "market", "leads", "engineering"] },
        blockId: { type: Type.STRING, description: "A canvas component id to select and zoom to." },
      },
    },
  },
];
