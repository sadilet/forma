"use client";

import { useEffect, useState } from "react";
import { useRoom } from "@liveblocks/react/suspense";
import {
  DocumentRecordType,
  IndexKey,
  InstancePresenceRecordType,
  PageRecordType,
  UserRecordType,
  atom,
  createPresenceStateDerivation,
  createTLStore,
  createUserId,
  defaultShapeUtils,
  react as track,
  type TLAnyShapeUtilConstructor,
  type TLDocument,
  type TLInstancePresence,
  type TLPageId,
  type TLRecord,
  type TLStoreEventInfo,
  type TLStoreWithStatus,
  type TLUser,
} from "tldraw";
import {
  createLiveblocksRecord,
  getLiveblocksJsonObject,
  getTldrawRecord,
  isLiveblocksRecord,
  reconcileLiveblocksRecord,
} from "@/lib/canvas/liveblocks-storage";

type Collaborator = {
  id: string;
  color: string;
  name: string;
};

/**
 * Syncs a tldraw store with Liveblocks Storage and Presence.
 * Adapted from the Liveblocks tldraw storage example for tldraw 5,
 * where presence is derived from a TLUser signal.
 */
export function useStorageStore({
  shapeUtils = [],
  user,
}: {
  shapeUtils?: TLAnyShapeUtilConstructor[];
  user: Collaborator;
}) {
  const room = useRoom();
  const [store] = useState(() =>
    createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    }),
  );
  const [userAtom] = useState(() =>
    atom<TLUser | null>(
      "forma-user",
      UserRecordType.create({
        id: createUserId(user.id),
        name: user.name,
        color: user.color,
      }),
    ),
  );
  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({ status: "loading" });

  useEffect(() => {
    userAtom.set(
      UserRecordType.create({
        id: createUserId(user.id),
        name: user.name,
        color: user.color,
      }),
    );
  }, [user.id, user.name, user.color, userAtom]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    let cancelled = false;

    async function setup() {
      try {
        const { root } = await room.getStorage();
        if (cancelled) return;
        const liveRecords = root.get("records");
        if (!liveRecords) {
          throw new Error("This workspace is missing canvas storage.");
        }

        const defaultRecords = [
          DocumentRecordType.create({ id: "document:document" as TLDocument["id"] }),
          PageRecordType.create({
            id: "page:page" as TLPageId,
            name: "Page 1",
            index: "a1" as IndexKey,
          }),
        ];

        room.batch(() => {
          for (const [id, liveRecord] of liveRecords.entries()) {
            if (isLiveblocksRecord(liveRecord)) continue;
            const record = getTldrawRecord(liveRecord);
            if (record) liveRecords.set(id, createLiveblocksRecord(record));
          }
          for (const record of defaultRecords) {
            if (!liveRecords.has(record.id)) {
              liveRecords.set(record.id, createLiveblocksRecord(record));
            }
          }
        });

        function recordsFromStorage() {
          const records: TLRecord[] = [];
          for (const liveRecord of liveRecords.values()) {
            const record = getTldrawRecord(liveRecord);
            if (record) records.push(record);
          }
          return records;
        }

        if (cancelled) return;
        store.clear();
        store.put(recordsFromStorage(), "initialize");

        unsubs.push(
          store.listen(
            ({ changes }) => {
              room.batch(() => {
                Object.values(changes.added).forEach((record) => {
                  liveRecords.set(record.id, createLiveblocksRecord(record));
                });
                Object.values(changes.updated).forEach(([, record]) => {
                  const liveRecord = liveRecords.get(record.id);
                  if (liveRecord && isLiveblocksRecord(liveRecord)) {
                    reconcileLiveblocksRecord(liveRecord, record);
                  } else {
                    liveRecords.set(record.id, createLiveblocksRecord(record));
                  }
                });
                Object.values(changes.removed).forEach((record) => {
                  liveRecords.delete(record.id);
                });
              });
            },
            { source: "user", scope: "document" },
          ),
        );

        function syncPresence({ changes }: TLStoreEventInfo) {
          room.batch(() => {
            Object.values(changes.added).forEach((record) => {
              room.updatePresence({ [record.id]: getLiveblocksJsonObject(record) });
            });
            Object.values(changes.updated).forEach(([, record]) => {
              room.updatePresence({ [record.id]: getLiveblocksJsonObject(record) });
            });
            Object.values(changes.removed).forEach((record) => {
              room.updatePresence({ [record.id]: null });
            });
          });
        }

        unsubs.push(store.listen(syncPresence, { source: "user", scope: "session" }));
        unsubs.push(store.listen(syncPresence, { source: "user", scope: "presence" }));

        unsubs.push(
          room.subscribe(
            liveRecords,
            () => {
              const toPut = recordsFromStorage();
              const recordIds = new Set(toPut.map((record) => record.id));
              const toRemove = store
                .allRecords()
                .filter(
                  (record) =>
                    store.scopedTypes.document.has(record.typeName) && !recordIds.has(record.id),
                )
                .map((record) => record.id);

              store.mergeRemoteChanges(() => {
                if (toRemove.length) store.remove(toRemove);
                if (toPut.length) store.put(toPut);
              });
            },
            { isDeep: true },
          ),
        );

        const connectionId = String(room.getSelf()?.connectionId ?? 0);
        const presenceDerivation = createPresenceStateDerivation(userAtom, {
          instanceId: InstancePresenceRecordType.createId(connectionId),
        })(store);

        const initialPresence = presenceDerivation.get();
        room.updatePresence({
          presence: initialPresence ? getLiveblocksJsonObject(initialPresence) : null,
        });

        unsubs.push(
          track("forma-presence", () => {
            const presenceRecord = presenceDerivation.get();
            const presence = presenceRecord ? getLiveblocksJsonObject(presenceRecord) : null;
            requestAnimationFrame(() => {
              if (!cancelled) room.updatePresence({ presence });
            });
          }),
        );

        unsubs.push(
          room.subscribe("others", (others, event) => {
            const toRemove: TLInstancePresence["id"][] = [];
            const toPut: TLInstancePresence[] = [];

            if (event.type === "leave") {
              if (event.user.connectionId) {
                toRemove.push(InstancePresenceRecordType.createId(`${event.user.connectionId}`));
              }
            } else if (event.type === "reset") {
              for (const other of others) {
                toRemove.push(InstancePresenceRecordType.createId(`${other.connectionId}`));
              }
            } else if (event.type === "enter" || event.type === "update") {
              const record = getTldrawRecord(event.user.presence?.presence);
              if (record?.typeName === "instance_presence") toPut.push(record as TLInstancePresence);
            }

            store.mergeRemoteChanges(() => {
              if (toRemove.length) store.remove(toRemove);
              if (toPut.length) store.put(toPut);
            });
          }),
        );

        if (cancelled) return;
        setStoreWithStatus({
          store,
          status: "synced-remote",
          connectionStatus: "online",
        });
      } catch (error) {
        if (cancelled) return;
        setStoreWithStatus({
          status: "error",
          error: error instanceof Error ? error : new Error("Could not sync the canvas."),
        });
      }
    }

    void setup();
    return () => {
      cancelled = true;
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [room, store, userAtom]);

  return storeWithStatus;
}
