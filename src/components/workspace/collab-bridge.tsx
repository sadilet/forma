"use client";

import { useEffect, useRef } from "react";
import { useEventListener, useSelf, useUpdateMyPresence } from "@liveblocks/react/suspense";
import { isFormaRoomEvent, type FormaRoomEvent } from "@/lib/collab/events";

export function CollabBridge({ onEvent }: { onEvent: (event: FormaRoomEvent) => void }) {
  useEventListener(({ event }) => {
    if (isFormaRoomEvent(event)) onEvent(event);
  });
  return null;
}

type PresenceTab = "review" | "market" | "leads" | "engineering" | "component";
type VoiceState = "idle" | "listening" | "speaking";

// FormaPresence and VoicePresence each own one field of the shared `forma` presence and keep the other's value.
export function FormaPresence({ tab }: { tab: PresenceTab }) {
  const update = useUpdateMyPresence();
  const voiceState = useSelf((me) => me.presence.forma?.voiceState);
  const voiceRef = useRef<VoiceState>("idle");
  useEffect(() => {
    voiceRef.current = voiceState ?? "idle";
  });
  useEffect(() => {
    update({
      forma: {
        workspaceStage: "design",
        architectTab: tab,
        buildTab: "preview",
        voiceState: voiceRef.current,
      },
    });
  }, [tab, update]);
  return null;
}

// Tells collaborators when this person is talking with Gemini Live.
export function VoicePresence({ state }: { state: VoiceState }) {
  const update = useUpdateMyPresence();
  const forma = useSelf((me) => me.presence.forma);
  const tabRef = useRef<PresenceTab>("review");
  useEffect(() => {
    tabRef.current = forma?.architectTab ?? "review";
  });
  useEffect(() => {
    update({
      forma: {
        workspaceStage: "design",
        architectTab: tabRef.current,
        buildTab: "preview",
        voiceState: state,
      },
    });
  }, [state, update]);
  return null;
}
