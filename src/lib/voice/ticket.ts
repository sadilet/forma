import { createHmac, timingSafeEqual } from "node:crypto";

// A voice ticket lets the browser open one Gemini Live session through the relay without ever seeing GEMINI_API_KEY.
// The web app mints it after checking the signed-in user. The relay verifies it with the same secret.

export const TICKET_TTL_MS = 60_000;

export type VoiceTicket = { userId: string; projectId: string; expiresAt: number };

export function sessionSecret() {
  return process.env.SESSION_SECRET || "forma-dev-session-secret";
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`voice:${payload}`).digest("base64url");
}

export function signTicket(input: { userId: string; projectId: string; secret: string; now?: number; ttlMs?: number }) {
  const expiresAt = (input.now ?? Date.now()) + (input.ttlMs ?? TICKET_TTL_MS);
  const payload = Buffer.from(JSON.stringify({ u: input.userId, p: input.projectId, e: expiresAt })).toString("base64url");
  return { ticket: `${payload}.${signature(payload, input.secret)}`, expiresAt };
}

export function verifyTicket(ticket: string, secret: string, now = Date.now()): VoiceTicket | null {
  const [payload, given] = ticket.split(".");
  if (!payload || !given) return null;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: unknown; p?: unknown; e?: unknown };
    if (typeof data.u !== "string" || typeof data.p !== "string" || typeof data.e !== "number") return null;
    if (data.e < now) return null;
    return { userId: data.u, projectId: data.p, expiresAt: data.e };
  } catch {
    return null;
  }
}
