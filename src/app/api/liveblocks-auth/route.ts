import { getCurrentUser } from "@/lib/auth";
import { getLiveblocks } from "@/lib/liveblocks";
import { z } from "zod";

const bodySchema = z.object({
  room: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "forbidden", reason: "Sign in before joining a workspace." },
      { status: 401 },
    );
  }

  const liveblocks = getLiveblocks();
  if (!liveblocks) {
    return Response.json(
      {
        error: "forbidden",
        reason: "Collaboration is not configured. Add LIVEBLOCKS_SECRET_KEY to .env.local and restart.",
      },
      { status: 503 },
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success || !parsed.data.room.startsWith("forma-")) {
    return Response.json(
      { error: "forbidden", reason: "That workspace cannot be joined." },
      { status: 403 },
    );
  }

  try {
    const session = liveblocks.prepareSession(user.id, {
      userInfo: {
        name: user.name,
        color: user.color,
        avatar: user.name.slice(0, 1).toUpperCase(),
      },
    });
    session.allow(parsed.data.room, ["*:write"]);
    const { status, body } = await session.authorize();
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Liveblocks rejected the session.";
    return Response.json({ error: "forbidden", reason }, { status: 401 });
  }
}
