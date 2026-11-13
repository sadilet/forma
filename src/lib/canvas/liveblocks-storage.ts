import { LiveObject, type JsonObject } from "@liveblocks/client";
import type { TLRecord } from "tldraw";

export type LiveblocksTldrawRecord = LiveObject<JsonObject>;
export type LiveblocksTldrawRecordValue = LiveblocksTldrawRecord | JsonObject;

export function createLiveblocksRecord(record: TLRecord): LiveblocksTldrawRecord {
  return LiveObject.from(getLiveblocksJsonObject(record)) as LiveblocksTldrawRecord;
}

export function reconcileLiveblocksRecord(liveRecord: LiveblocksTldrawRecord, record: TLRecord) {
  liveRecord.reconcile(getLiveblocksJsonObject(record));
}

export function getTldrawRecord(
  liveRecord: LiveblocksTldrawRecordValue | null | undefined,
): TLRecord | undefined {
  const record = getTldrawRecordJson(liveRecord);
  if (!record || !isTldrawRecordLike(record)) return undefined;
  return record as unknown as TLRecord;
}

export function isLiveblocksRecord(value: unknown): value is LiveblocksTldrawRecord {
  return value instanceof LiveObject;
}

export function getLiveblocksJsonObject(record: TLRecord): JsonObject {
  return JSON.parse(JSON.stringify(record)) as JsonObject;
}

function getTldrawRecordJson(
  liveRecord: LiveblocksTldrawRecordValue | null | undefined,
): JsonObject | undefined {
  if (isLiveblocksRecord(liveRecord)) return liveRecord.toJSON() as JsonObject;
  if (!liveRecord || typeof liveRecord !== "object" || Array.isArray(liveRecord)) return undefined;
  return liveRecord;
}

function isTldrawRecordLike(value: JsonObject): value is JsonObject & { id: string; typeName: string } {
  return typeof value.id === "string" && typeof value.typeName === "string";
}
