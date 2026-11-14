export type MergeableMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export function mergeMessages<T extends MergeableMessage>(current: T[], incoming: T[], limit = 40): T[] {
  const byId = new Map<string, T>();
  for (const message of [...current, ...incoming]) {
    const existing = byId.get(message.id);
    if (!existing || message.content.length >= existing.content.length) byId.set(message.id, message);
  }
  return [...byId.values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(-limit);
}
