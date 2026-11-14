import { z } from "zod";

// Messages between the browser and the voice relay. The relay holds the Gemini key and the Live session;
// the browser sends microphone audio and canvas frames, and runs the tools that need the canvas or the UI.

// From the Gemini Live docs (get-started-sdk): audio goes in as 16-bit 16kHz little-endian PCM.
export const LIVE_INPUT_AUDIO_MIME = "audio/pcm;rate=16000";
export const LIVE_VIDEO_MIME = "image/jpeg";
// From the same docs: video frames are sent as images at most once per second.
export const LIVE_MIN_FRAME_INTERVAL_MS = 1000;

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
export const DEFAULT_RELAY_PORT = 8787;

export const VOICE_TOOLS = ["get_canvas_details", "get_workspace_context", "lookup_web", "scaffold_canvas", "navigate_workspace"] as const;
export type VoiceToolName = (typeof VOICE_TOOLS)[number];

export const CONTEXT_SCOPES = [
  "review",
  "market",
  "leads",
  "engineering",
  "component",
  "specifications",
  "all",
] as const;
export type ContextScope = (typeof CONTEXT_SCOPES)[number];

// Fast Context.dev lookups during a voice call. Prefer saved packs first; use these when something is not researched yet.
export const LOOKUP_KINDS = ["answer", "web", "companies", "people", "news"] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

export function isLookupKind(value: unknown): value is LookupKind {
  return typeof value === "string" && (LOOKUP_KINDS as readonly string[]).includes(value);
}

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), instructions: z.string().max(16_000) }),
  z.object({ type: z.literal("audio"), data: z.string().max(400_000) }),
  z.object({ type: z.literal("audioStreamEnd") }),
  z.object({ type: z.literal("video"), data: z.string().max(6_000_000) }),
  z.object({ type: z.literal("text"), text: z.string().max(4_000) }),
  z.object({
    type: z.literal("toolResponse"),
    responses: z
      .array(z.object({ id: z.string().optional(), name: z.string(), response: z.record(z.string(), z.unknown()) }))
      .min(1)
      .max(8),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = clientMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// What the relay sends back. `message` is the Gemini LiveServerMessage, passed through as received.
export type RelayMessage =
  | { type: "ready" }
  | { type: "message"; message: unknown }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string };

// Parses the sample rate out of a model audio mime type such as "audio/pcm;rate=24000".
// Returns null when the model did not say, so the caller decides the fallback.
export function sampleRateOf(mimeType: string | undefined): number | null {
  const match = /rate=(\d{4,6})/i.exec(mimeType ?? "");
  return match ? Number(match[1]) : null;
}
