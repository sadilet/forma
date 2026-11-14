// The four validation pillars of the Architect, and how each one maps onto a saved conversation and a chat mode.
// Pure module: used by the browser, the API routes, and node tests.

export const ARCHITECT_TABS = ["review", "market", "leads", "engineering"] as const;

export type ArchitectTab = (typeof ARCHITECT_TABS)[number];

export const CHAT_MODES = ["global", "review", "local", "market", "leads", "engineering"] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

// `blockKey` is how conversations are stored. The review thread has always lived under the empty key.
export const TAB_BLOCK_KEY: Record<ArchitectTab, string> = {
  review: "",
  market: "__market__",
  leads: "__leads__",
  engineering: "__engineering__",
};

export const TAB_CHAT_MODE: Record<ArchitectTab, ChatMode> = {
  review: "review",
  market: "market",
  leads: "leads",
  engineering: "engineering",
};

export const TAB_META: Record<ArchitectTab, { label: string; subtitle: string; noun: string }> = {
  review: { label: "Review", subtitle: "Product gaps", noun: "product review" },
  market: { label: "Market", subtitle: "Demand & wedge", noun: "market research" },
  leads: { label: "Leads", subtitle: "Initial buyers", noun: "buyer leads" },
  engineering: { label: "Engineering", subtitle: "Docs & rigor", noun: "engineering grounding" },
};

export function isArchitectTab(value: unknown): value is ArchitectTab {
  return typeof value === "string" && (ARCHITECT_TABS as readonly string[]).includes(value);
}

export function tabForBlockKey(blockKey: string): ArchitectTab | null {
  for (const tab of ARCHITECT_TABS) {
    if (TAB_BLOCK_KEY[tab] === blockKey) return tab;
  }
  return null;
}
