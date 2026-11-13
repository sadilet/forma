import "server-only";

import { Liveblocks } from "@liveblocks/node";

let client: Liveblocks | null = null;

export function collaborationConfigured() {
  return Boolean(process.env.LIVEBLOCKS_SECRET_KEY);
}

export function getLiveblocks() {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) return null;
  if (!client) client = new Liveblocks({ secret });
  return client;
}
