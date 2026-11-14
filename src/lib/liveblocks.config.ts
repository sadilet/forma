import type { JsonObject, LiveMap, LiveObject } from "@liveblocks/client";

declare global {
  interface Liveblocks {
    Presence: {
      presence: JsonObject | null;
      forma?: {
        workspaceStage: "design" | "build";
        architectTab: "review" | "market" | "leads" | "component";
        buildTab: "preview" | "engineering" | "code";
        voiceState: "idle" | "listening" | "speaking";
      };
      [key: string]: JsonObject | null | undefined;
    };
    RoomEvent: {
      type: "RESOURCE_UPDATED";
      resource:
        | "goal"
        | "analysis"
        | "market"
        | "leads"
        | "specification"
        | "conversation"
        | "docs"
        | "standards"
        | "build"
        | "signoff";
      blockId?: string;
      actorId: string;
      actorName: string;
      timestamp: number;
      summary: string;
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
