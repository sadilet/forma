"use client";

import { useEffect } from "react";
import { useEventListener, useUpdateMyPresence } from "@liveblocks/react/suspense";
import { isFormaRoomEvent, type FormaRoomEvent } from "@/lib/collab/events";

export function CollabBridge({ onEvent }: { onEvent: (event: FormaRoomEvent) => void }) {
  useEventListener(({ event }) => {
    if (isFormaRoomEvent(event)) onEvent(event);
  });
  return null;
}

export function FormaPresence({
  tab,
}: {
  tab: "review" | "market" | "leads" | "component";
}) {
  const update = useUpdateMyPresence();
  useEffect(() => {
    update({
      forma: {
        workspaceStage: "design",
        architectTab: tab,
        buildTab: "preview",
        voiceState: "idle",
      },
    });
  }, [tab, update]);
  return null;
}
