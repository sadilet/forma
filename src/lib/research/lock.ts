const runs = new Set<string>();

export function claimRun(key: string) {
  if (runs.has(key)) return false;
  runs.add(key);
  return true;
}

export function finishRun(key: string) {
  runs.delete(key);
}
