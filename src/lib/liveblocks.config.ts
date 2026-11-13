import type { JsonObject, LiveMap, LiveObject } from "@liveblocks/client";

declare global {
  interface Liveblocks {
    Presence: {
      presence: JsonObject | null;
      [key: string]: JsonObject | null | undefined;
    };
    Storage: {
      records: LiveMap<string, LiveObject<JsonObject>>;
      seeded: boolean;
    };
    UserMeta: {
      id: string;
      info: {
        name: string;
        color: string;
        avatar: string;
      };
    };
  }
}

export {};
