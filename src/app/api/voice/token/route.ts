import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { geminiApiKey } from "@/lib/ai/provider";
import { getProject } from "@/lib/projects";
import { DEFAULT_LIVE_MODEL, DEFAULT_RELAY_PORT } from "@/lib/voice/protocol";
import { sessionSecret, signTicket } from "@/lib/voice/ticket";

const bodySchema = z.object({ projectId: z.string().min(1) });

// Mints a one-minute ticket for the voice relay (`npm run voice:relay`). GEMINI_API_KEY stays on the server:
// the relay holds the Live session, and the browser only ever sees this ticket.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to talk with the architect." }, { status: 401 });
  if (!geminiApiKey()) {
    return Response.json(
      { error: "Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the server." },
      { status: 503 },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Missing workspace." }, { status: 400 });
  const project = await getProject(parsed.data.projectId);
  if (!project) return Response.json({ error: "This workspace no longer exists." }, { status: 404 });

  const { ticket, expiresAt } = signTicket({ userId: user.id, projectId: project.id, secret: sessionSecret() });
  return Response.json({
    ticket,
    expiresAt,
    model: process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL,
    // A full public URL wins (for example wss://voice.example.com). Otherwise the browser uses its own host and this port.
    relayUrl: process.env.VOICE_RELAY_URL?.trim() || null,
    relayPort: Number(process.env.VOICE_RELAY_PORT) || DEFAULT_RELAY_PORT,
  });
}
