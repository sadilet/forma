import "server-only";

import OpenAI from "openai";

export function openAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
}

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export const ARCHITECT_RULES = `You are Forma's product architect. You work with a team designing software on a shared canvas.
Be specific to the components and connections you were given. Do not invent behavior that is already decided, and do not pretend a missing component already exists.
Speak like a staff engineer in a design review: concrete, calm, and precise. Name failure cases, data, and boundaries.
Never claim that you changed the canvas or saved a specification. The team confirms every change.`;
