export const BLOCK_KINDS = [
  "screen",
  "service",
  "database",
  "entity",
  "decision",
  "note",
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

export const PROJECT_TEMPLATES = ["blank", "taskflow", "meetings", "slotguard"] as const;

export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

export const FORMA_BLOCK_TYPE = "forma-block";

export const TASKFLOW_PROJECT_ID = "project-taskflow";

export const SLOTGUARD_PROJECT_ID = "project-slotguard";

export const SLOTGUARD_BLOCKS = {
  intent: "shape:sg-intent",
  pricing: "shape:sg-pricing",
  depositRules: "shape:sg-deposit-rules",
  provider: "shape:sg-provider",
  bookingPage: "shape:sg-booking-page",
  checkout: "shape:sg-checkout",
  cancel: "shape:sg-cancel",
  dashboard: "shape:sg-dashboard",
  services: "shape:sg-services",
  engine: "shape:sg-engine",
  deposits: "shape:sg-deposits",
  notifications: "shape:sg-notifications",
  store: "shape:sg-store",
  owner: "shape:sg-owner",
  client: "shape:sg-client",
  appointment: "shape:sg-appointment",
} as const;

export const MEETINGS_PROJECT_ID = "project-meetings";

export const MEETINGS_BLOCKS = {
  customer: "shape:m-customer",
  pricing: "shape:m-pricing",
  transcriptionChoice: "shape:m-transcription-choice",
  calendar: "shape:m-calendar",
  recorder: "shape:m-recorder",
  transcription: "shape:m-transcription",
  summarizer: "shape:m-summarizer",
  meetingsDb: "shape:m-meetings-db",
  meetingView: "shape:m-meeting-view",
} as const;

export const TASKFLOW_BLOCKS = {
  user: "shape:user",
  login: "shape:login",
  dashboard: "shape:dashboard",
  taskList: "shape:task-list",
  createTask: "shape:create-task",
  postgres: "shape:postgres",
  notifications: "shape:notifications",
  lifecycle: "shape:lifecycle",
  intent: "shape:intent",
} as const;

export const BLOCK_META: Record<
  BlockKind,
  { label: string; color: string; defaultTitle: string }
> = {
  screen: { label: "Screen", color: "#6ea8fe", defaultTitle: "Screen" },
  service: { label: "Service", color: "#a78bfa", defaultTitle: "Service" },
  database: { label: "Database", color: "#f0a05a", defaultTitle: "Database" },
  entity: { label: "Entity", color: "#5dcaa5", defaultTitle: "Entity" },
  decision: { label: "Decision", color: "#e8c36a", defaultTitle: "Decision" },
  note: { label: "Note", color: "#c4c6d0", defaultTitle: "Note" },
};

// Block colors are pastel accents. Text set in them needs to follow the theme, so blend toward the ink color.
export function blockInk(color: string) {
  return `color-mix(in srgb, ${color} 55%, var(--foreground))`;
}

export const TASKFLOW_GOAL =
  "TaskFlow helps small teams capture, assign, and complete work. This canvas is a first pass: account access, a home dashboard, task lists, task creation, persistence, and notifications. Billing, roles, and failure behavior are still open.";

export const SLOTGUARD_GOAL =
  "SlotGuard helps local service businesses cut no-show losses by collecting a small refundable deposit at booking time. Owners get a booking link and a simple dashboard; clients see clear cancel rules. This canvas is the first pass: booking, deposits, refunds, and owner visibility. Pricing, payment provider, and deposit rules are still open.";

export const MEETINGS_GOAL =
  "Meeting Notes helps small B2B teams turn meetings into summaries, decisions, and action items. This canvas is a first sketch of the product. Pricing, the transcription vendor, and the niche are still open.";
