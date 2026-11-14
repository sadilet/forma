import { groundingHandlers } from "@/lib/research/grounding-route";

export const maxDuration = 180;

const handlers = groundingHandlers("docs");

export const GET = handlers.GET;
export const POST = handlers.POST;
