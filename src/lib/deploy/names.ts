import { createHash } from "node:crypto";

// Cloud Run service names: lowercase letters, digits, and hyphens. They start with a letter, end with
// a letter or digit, and are at most 49 characters long.
const MAX_SERVICE_NAME = 49;

export function serviceNameFor(projectId: string): string {
  const slug = projectId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `forma-${slug || "app"}`;
  const clean = slug !== "" && slug === projectId.toLowerCase();
  if (clean && base.length <= MAX_SERVICE_NAME) return base;
  // The name was changed or cut, so two project ids could collide. A short hash of the id keeps them apart.
  const hash = createHash("sha1").update(projectId).digest("hex").slice(0, 6);
  const head = base.slice(0, MAX_SERVICE_NAME - hash.length - 1).replace(/-+$/g, "");
  return `${head}-${hash}`;
}

// Cloud Run label values: lowercase letters, digits, underscores, and hyphens, at most 63 characters.
export function labelValue(value: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 63);
  return clean || "none";
}
