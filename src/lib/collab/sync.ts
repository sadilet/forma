import type { FormaRoomEvent, ResourceKind } from "./events.ts";

export type SyncVersions = Readonly<Record<string, number>>;

function syncKey(resource: ResourceKind, blockId: string | undefined) {
  return `${resource}:${blockId ?? ""}`;
}

export function recordEvent(versions: SyncVersions, event: FormaRoomEvent): SyncVersions {
  const key = syncKey(event.resource, event.blockId);
  return { ...versions, [key]: (versions[key] ?? 0) + 1 };
}

export function versionOf(versions: SyncVersions, resource: ResourceKind, blockId?: string) {
  return versions[syncKey(resource, blockId)] ?? 0;
}
