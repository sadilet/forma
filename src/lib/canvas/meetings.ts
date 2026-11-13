"use client";

import { type Editor, type TLShapeId } from "tldraw";
import { FORMA_BLOCK_TYPE, MEETINGS_BLOCKS, type BlockKind } from "@/lib/canvas/kinds";
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
const SEED_VERSION = 2;

const BLOCKS: SeedBlock[] = [
  // Top row: who it is for, what is undecided, and what people see.
  {
    id: MEETINGS_BLOCKS.customer,
    kind: "note",
    title: "Product intent",
    description:
      "Small B2B teams of 5–50 people who hold many meetings and lose decisions and action items afterwards. Finnish-language meetings may be a niche. That is not verified yet.",
    x: 80,
    y: 40,
  },
  {
    id: MEETINGS_BLOCKS.pricing,
    kind: "decision",
    title: "Pricing model",
    description: "Per seat, per meeting hour, or flat. Undecided.",
    x: 560,
    y: 40,
  },
  {
    id: MEETINGS_BLOCKS.transcriptionChoice,
    kind: "decision",
    title: "Build or buy transcription",
    description:
      "An own model or a vendor API, including Finnish language support. Undecided.",
    x: 1040,
    y: 40,
  },
  {
    id: MEETINGS_BLOCKS.meetingView,
    kind: "screen",
    title: "Meeting view",
    description:
      "Shows the transcript, summary, and action items for one meeting. Editing, sharing, and search are not defined.",
    x: 2000,
    y: 40,
  },

  // Pipeline row: from calendar to stored notes.
  {
    id: MEETINGS_BLOCKS.calendar,
    kind: "service",
    title: "Calendar sync",
    description:
      "Reads upcoming meetings from the team's calendar. Providers, permissions, and consent are not specified.",
    x: 80,
    y: 420,
  },
  {
    id: MEETINGS_BLOCKS.recorder,
    kind: "service",
    title: "Meeting recorder",
    description:
      "Joins or captures the meeting audio. How it joins and how participants are told are not decided.",
    x: 560,
    y: 420,
  },
  {
    id: MEETINGS_BLOCKS.transcription,
    kind: "service",
    title: "Transcription",
    description:
      "Turns audio into text with speaker labels. Languages and accuracy targets are open.",
    x: 1040,
    y: 420,
  },
  {
    id: MEETINGS_BLOCKS.summarizer,
    kind: "service",
    title: "Summarizer",
    description:
      "Produces a summary, decisions, and action items from the transcript. The format and a review step are not defined.",
    x: 1520,
    y: 420,
  },
  {
    id: MEETINGS_BLOCKS.meetingsDb,
    kind: "database",
    title: "Meetings store",
    description:
      "Keeps meetings, transcripts, summaries, and action items. Schema, retention, and deletion are not specified.",
    x: 2000,
    y: 420,
  },
];

const LINKS: { from: string; to: string; label: string }[] = [
  { from: MEETINGS_BLOCKS.customer, to: MEETINGS_BLOCKS.pricing, label: "pays" },
  { from: MEETINGS_BLOCKS.transcriptionChoice, to: MEETINGS_BLOCKS.transcription, label: "chooses" },
  { from: MEETINGS_BLOCKS.calendar, to: MEETINGS_BLOCKS.recorder, label: "schedules" },
  { from: MEETINGS_BLOCKS.recorder, to: MEETINGS_BLOCKS.transcription, label: "audio" },
  { from: MEETINGS_BLOCKS.transcription, to: MEETINGS_BLOCKS.summarizer, label: "transcript" },
  { from: MEETINGS_BLOCKS.summarizer, to: MEETINGS_BLOCKS.meetingsDb, label: "writes" },
  { from: MEETINGS_BLOCKS.meetingView, to: MEETINGS_BLOCKS.meetingsDb, label: "reads" },
];

export function canvasNeedsMeetingsSeed(editor: Editor) {
  return editor.getDocumentSettings().meta.formaSeedVersion !== SEED_VERSION;
}

export function seedMeetings(editor: Editor) {
  if (!canvasNeedsMeetingsSeed(editor)) return;

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

    for (const link of LINKS) connect(editor, link.from as TLShapeId, link.to as TLShapeId, link.label);
  });

  editor.zoomToFit({ animation: { duration: 0 } });
  editor.selectNone();
}
