import "server-only";

import type { FormaRoomEvent, ResourceKind } from "@/lib/collab/events";
import { getLiveblocks } from "@/lib/liveblocks";

export async function publishResourceUpdate(input: {
  roomId: string;
  resource: ResourceKind;
  actorId: string;
  actorName: string;
  summary: string;
  blockId?: string;
}) {
  const liveblocks = getLiveblocks();
  if (!liveblocks) return;
  const event: FormaRoomEvent = {
    type: "RESOURCE_UPDATED",
    resource: input.resource,
    actorId: input.actorId,
    actorName: input.actorName,
    summary: input.summary,
    timestamp: Date.now(),
    ...(input.blockId === undefined ? {} : { blockId: input.blockId }),
  };
  try {
    await liveblocks.broadcastEvent(input.roomId, event);
  } catch (error) {
    console.error("Could not notify collaborators.", error instanceof Error ? error.message : "unknown");
  }
}
