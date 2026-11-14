"use client";

import { type Editor, type TLShapeId } from "tldraw";
import { FORMA_BLOCK_TYPE, SLOTGUARD_BLOCKS as B, type BlockKind } from "@/lib/canvas/kinds";
import { connect } from "@/lib/canvas/taskflow";

type SeedBlock = {
  id: string;
  kind: BlockKind;
  title: string;
  description: string;
  x: number;
  y: number;
};

// Bump when the blocks or links below change, so existing canvases are reseeded.
const SEED_VERSION = 1;

// Five rows, six columns. Rows are 380 apart and columns 480 apart, so every arrow has a clear lane.
const COL = [80, 560, 1040, 1520, 2000, 2480];
const ROW = [40, 420, 800, 1180, 1560];

const BLOCKS: SeedBlock[] = [
  // Row 0: who it is for and what clients see first.
  {
    id: B.client,
    kind: "entity",
    title: "Client",
    description: "Booker. May be a guest (email or phone only) in v1.",
    x: COL[0],
    y: ROW[0],
  },
  {
    id: B.bookingPage,
    kind: "screen",
    title: "Public booking page",
    description:
      "Client picks a service and a time, enters contact details, and sees the deposit amount and cancel policy before paying.",
    x: COL[1],
    y: ROW[0],
  },
  {
    id: B.intent,
    kind: "note",
    title: "Product intent",
    description:
      "Independent salons, clinics, tutors, and studios (1–5 chairs or rooms) lose money on no-shows. SlotGuard sells to the owner: booking link, deposit rules, and a dashboard. Not a full salon OS.",
    x: COL[2],
    y: ROW[0],
  },
  {
    id: B.pricing,
    kind: "decision",
    title: "Pricing model",
    description:
      "Undecided: flat SaaS per location, a percentage of deposits, or a hybrid. Must be settled with market research before the strategy is locked.",
    x: COL[4],
    y: ROW[0],
  },

  // Row 1: the deposit flow on the client side.
  {
    id: B.checkout,
    kind: "screen",
    title: "Deposit checkout",
    description:
      "Collects the deposit and shows success and an appointment summary. In this demo build checkout is a mock: every deposit is confirmed and no money is charged. Failure and retry behavior are not specified.",
    x: COL[1],
    y: ROW[1],
  },
  {
    id: B.depositRules,
    kind: "decision",
    title: "Deposit rules",
    description:
      "Undecided: deposit amount (percent of the service or a fixed amount), cancel cutoff (for example 24 hours), keep 100% or part on a late cancel, and how no-shows are handled.",
    x: COL[2],
    y: ROW[1],
  },
  {
    id: B.cancel,
    kind: "screen",
    title: "Cancel / reschedule",
    description:
      "Client cancels or reschedules. The system applies the refund or keep rules based on the cutoff.",
    x: COL[3],
    y: ROW[1],
  },

  // Row 2: services that run the booking and the money.
  {
    id: B.services,
    kind: "screen",
    title: "Services & availability",
    description:
      "Owner defines services, prices, durations, and open hours. v1 can be minimal.",
    x: COL[0],
    y: ROW[2],
  },
  {
    id: B.engine,
    kind: "service",
    title: "Booking engine",
    description:
      "Creates appointments against availability and prevents double-booking. Concurrency rules are open.",
    x: COL[1],
    y: ROW[2],
  },
  {
    id: B.deposits,
    kind: "service",
    title: "Deposit & refunds",
    description:
      "Creates the deposit, then handles capture, refund, and forfeit per the deposit rules. The demo build uses a mock provider that always confirms. A real provider needs webhook verification.",
    x: COL[2],
    y: ROW[2],
  },
  {
    id: B.provider,
    kind: "decision",
    title: "Payments provider",
    description:
      "Undecided: Stripe (cards, payment intents) or another provider. Affects webhooks, refunds, and the docs pack. The demo build uses a mock.",
    x: COL[3],
    y: ROW[2],
  },

  // Row 3: storage, notifications, and the owner's view.
  {
    id: B.notifications,
    kind: "service",
    title: "Notifications",
    description:
      "Sends booking confirmed, reminder, and cancel outcomes. Email first. SMS is undecided.",
    x: COL[1],
    y: ROW[3],
  },
  {
    id: B.store,
    kind: "database",
    title: "SlotGuard store",
    description:
      "Persists owners, services, slots, appointments, payment references, and an audit of deposit state changes.",
    x: COL[2],
    y: ROW[3],
  },
  {
    id: B.dashboard,
    kind: "screen",
    title: "Owner dashboard",
    description:
      "Lists today's and upcoming appointments with the deposit status: authorized, captured, refunded, or forfeited.",
    x: COL[4],
    y: ROW[3],
  },
  {
    id: B.owner,
    kind: "entity",
    title: "Owner",
    description: "The paying customer. Login and business profile now, payout settings later.",
    x: COL[5],
    y: ROW[3],
  },

  // Row 4
  {
    id: B.appointment,
    kind: "entity",
    title: "Appointment",
    description: "Service, time, client, and the deposit state machine.",
    x: COL[2],
    y: ROW[4],
  },
];

type Anchor = { x: number; y: number };
type Link = { from: string; to: string; label: string; start?: Anchor; end?: Anchor };

const LINKS: Link[] = [
  { from: B.client, to: B.bookingPage, label: "books" },
  { from: B.bookingPage, to: B.checkout, label: "continues" },
  { from: B.intent, to: B.pricing, label: "frames" },
  { from: B.intent, to: B.depositRules, label: "frames" },
  { from: B.pricing, to: B.dashboard, label: "shapes plan" },
  { from: B.depositRules, to: B.checkout, label: "shown in" },
  { from: B.depositRules, to: B.cancel, label: "applied in" },
  { from: B.depositRules, to: B.deposits, label: "governs" },
  { from: B.provider, to: B.deposits, label: "powers" },
  // Both land on the left of Deposit & refunds, so they end at different heights.
  { from: B.checkout, to: B.deposits, label: "pays", end: { x: 0, y: 0.2 } },
  { from: B.checkout, to: B.engine, label: "reserves" },
  { from: B.cancel, to: B.deposits, label: "refunds", end: { x: 1, y: 0.2 } },
  // Starts low on the right of Booking engine so it does not meet the arrow above.
  { from: B.engine, to: B.store, label: "writes", start: { x: 1, y: 0.85 } },
  { from: B.deposits, to: B.store, label: "audits" },
  { from: B.dashboard, to: B.store, label: "reads" },
  { from: B.services, to: B.engine, label: "offers" },
  { from: B.engine, to: B.notifications, label: "events" },
  { from: B.owner, to: B.dashboard, label: "uses" },
  { from: B.appointment, to: B.store, label: "stored in" },
];

export function canvasNeedsSlotguardSeed(editor: Editor) {
  return editor.getDocumentSettings().meta.formaSeedVersion !== SEED_VERSION;
}

export function seedSlotguard(editor: Editor) {
  if (!canvasNeedsSlotguardSeed(editor)) return;

  editor.run(() => {
    const existing = editor.getCurrentPageShapes().map((shape) => shape.id);
    if (existing.length) editor.deleteShapes(existing);
    const doc = editor.getDocumentSettings();
    editor.updateDocumentSettings({
      meta: { ...doc.meta, formaSeeded: true, formaSeedVersion: SEED_VERSION },
    });

    for (const block of BLOCKS) {
      editor.createShape({
        id: block.id as TLShapeId,
        type: FORMA_BLOCK_TYPE,
        x: block.x,
        y: block.y,
        props: {
          kind: block.kind,
          title: block.title,
          description: block.description,
          w: 248,
          h: 136,
        },
      });
    }

    for (const link of LINKS) {
      connect(editor, link.from as TLShapeId, link.to as TLShapeId, link.label, {
        start: link.start,
        end: link.end,
      });
    }
  });

  editor.zoomToFit({ animation: { duration: 0 } });
  editor.selectNone();
}
