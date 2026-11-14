"use client";

import { useOthersMapped, useSelf, useStatus } from "@liveblocks/react/suspense";
import { initials } from "@/lib/utils";

export function LiveAvatars() {
  const self = useSelf((me) => ({ name: me.info.name, color: me.info.color }));
  const others = useOthersMapped((other) => ({
    connectionId: other.connectionId,
    name: other.info.name,
    color: other.info.color,
  }));

  return (
    <div className="flex items-center pl-1">
      <Avatar name={self.name} color={self.color} title={`${self.name} (you)`} />
      {others.map(([connectionId, person]) => (
        <Avatar
          key={connectionId}
          name={person.name}
          color={person.color}
          title={person.name}
          overlap
        />
      ))}
    </div>
  );
}

export function LiveStatus() {
  const status = useStatus();
  const others = useOthersMapped((other) => other.connectionId);
  const label =
    status === "connected"
      ? others.length === 0
        ? "Live · waiting for others"
        : `Live · ${others.length + 1} people`
      : status === "reconnecting"
        ? "Reconnecting"
        : status === "connecting" || status === "initial"
          ? "Connecting"
          : "Offline";
  const dot = status === "connected" ? "bg-success" : status === "disconnected" ? "bg-danger" : "bg-warning";

  return (
    <span title={label} className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="live-status-label">{label}</span>
    </span>
  );
}

function Avatar({
  name,
  color,
  title,
  overlap,
}: {
  name: string;
  color: string;
  title: string;
  overlap?: boolean;
}) {
  return (
    <span
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-[#101114] ring-2 ring-background ${overlap ? "-ml-2" : ""}`}
      style={{ background: color }}
    >
      {initials(name)}
    </span>
  );
}
