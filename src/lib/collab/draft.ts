export type Synced<T> = { value: T; version: number | null };

export type Draft<T> = {
  saved: Synced<T>;
  edits: T | null;
  incoming: Synced<T> | null;
};

export function startDraft<T>(saved: Synced<T>): Draft<T> {
  return { saved, edits: null, incoming: null };
}

export function draftValue<T>(draft: Draft<T>) {
  return draft.edits ?? draft.saved.value;
}

export function editDraft<T>(draft: Draft<T>, value: T): Draft<T> {
  return { ...draft, edits: value };
}

export function receiveRemote<T>(draft: Draft<T>, remote: Synced<T>, held = draft.edits !== null): Draft<T> {
  if (remote.version !== null && draft.saved.version !== null && remote.version <= draft.saved.version) return draft;
  if (held) return { ...draft, incoming: remote };
  return startDraft(remote);
}

export function takeIncoming<T>(draft: Draft<T>): Draft<T> {
  return draft.incoming ? startDraft(draft.incoming) : draft;
}

export function keepEdits<T>(draft: Draft<T>): Draft<T> {
  return draft.incoming ? { saved: draft.incoming, edits: draft.edits, incoming: null } : draft;
}

export function markSaved<T>(draft: Draft<T>, saved: Synced<T>, sent: T | null): Draft<T> {
  return { saved, edits: draft.edits === sent ? null : draft.edits, incoming: null };
}

export function compareAndSet<T>(current: T, expected: T | undefined, next: T) {
  if (next === current) return "unchanged" as const;
  if (expected !== undefined && expected !== current) return "conflict" as const;
  return "write" as const;
}
