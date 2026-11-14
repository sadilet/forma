export const RESOURCE_KINDS = [
  "goal",
  "analysis",
  "market",
  "leads",
  "specification",
  "conversation",
  "docs",
  "standards",
  "build",
  "signoff",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type FormaRoomEvent = {
  type: "RESOURCE_UPDATED";
  resource: ResourceKind;
  blockId?: string;
  actorId: string;
  actorName: string;
  timestamp: number;
  summary: string;
};

export function isFormaRoomEvent(value: unknown): value is FormaRoomEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<FormaRoomEvent>;
  return (
    event.type === "RESOURCE_UPDATED" &&
    typeof event.resource === "string" &&
    (RESOURCE_KINDS as readonly string[]).includes(event.resource) &&
    typeof event.actorId === "string" &&
    typeof event.actorName === "string" &&
    typeof event.timestamp === "number" &&
    typeof event.summary === "string"
  );
}
