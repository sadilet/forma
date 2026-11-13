"use client";

import {
  createBindingId,
  createShapeId,
  toRichText,
  type Editor,
  type TLShapeId,
} from "tldraw";
import { FORMA_BLOCK_TYPE, TASKFLOW_BLOCKS, type BlockKind } from "@/lib/canvas/kinds";

type SeedBlock = {
  id: string;
  kind: BlockKind;
  title: string;
  description: string;
  x: number;
  y: number;
};

const SEED_VERSION = 3;

const BLOCKS: SeedBlock[] = [
  {
    id: TASKFLOW_BLOCKS.user,
    kind: "entity",
    title: "User",
    description: "A person with an email and a name. Roles and invitations are not modeled.",
    x: 80,
    y: 140,
  },
  {
    id: TASKFLOW_BLOCKS.login,
    kind: "screen",
    title: "Login",
    description: "Email and password sign-in. Failure, lockout, and password reset are not specified.",
    x: 560,
    y: 140,
  },
  {
    id: TASKFLOW_BLOCKS.dashboard,
    kind: "screen",
    title: "Dashboard",
    description: "Home after login. The summary a person should see here is still undecided.",
    x: 1040,
    y: 140,
  },
  {
    id: TASKFLOW_BLOCKS.taskList,
    kind: "screen",
    title: "Task List",
    description: "Shows the team's tasks. Filtering, sorting, and the empty state are not defined.",
    x: 1520,
    y: 40,
  },
  {
    id: TASKFLOW_BLOCKS.createTask,
    kind: "screen",
    title: "Create Task",
    description: "A form for a new task. Required fields, assignment, and validation are still open.",
    x: 2000,
    y: 40,
  },
  {
    id: TASKFLOW_BLOCKS.postgres,
    kind: "database",
    title: "PostgreSQL",
    description: "Primary store for users and tasks. Schema, indexes, and backups are not specified.",
    x: 1520,
    y: 420,
  },
  {
    id: TASKFLOW_BLOCKS.notifications,
    kind: "service",
    title: "Notification Service",
    description: "Sends updates when tasks change. Channels, retries, and preferences are unspecified.",
    x: 1040,
    y: 420,
  },
  {
    id: TASKFLOW_BLOCKS.lifecycle,
    kind: "decision",
    title: "Task lifecycle",
    description: "Tasks move between states. The states, and who can change them, are not decided.",
    x: 2000,
    y: 420,
  },
  {
    id: TASKFLOW_BLOCKS.intent,
    kind: "note",
    title: "Product intent",
    description: "A calm task manager for teams of 2–20. Billing, roles, and offline use are out of scope for now.",
    x: 80,
    y: 420,
  },
];

const LINKS: { from: string; to: string; label: string }[] = [
  { from: TASKFLOW_BLOCKS.user, to: TASKFLOW_BLOCKS.login, label: "authenticates" },
  { from: TASKFLOW_BLOCKS.login, to: TASKFLOW_BLOCKS.dashboard, label: "enters" },
  { from: TASKFLOW_BLOCKS.dashboard, to: TASKFLOW_BLOCKS.taskList, label: "opens" },
  { from: TASKFLOW_BLOCKS.dashboard, to: TASKFLOW_BLOCKS.notifications, label: "watches" },
  { from: TASKFLOW_BLOCKS.taskList, to: TASKFLOW_BLOCKS.createTask, label: "creates" },
  { from: TASKFLOW_BLOCKS.taskList, to: TASKFLOW_BLOCKS.postgres, label: "reads" },
  { from: TASKFLOW_BLOCKS.createTask, to: TASKFLOW_BLOCKS.postgres, label: "writes" },
  { from: TASKFLOW_BLOCKS.createTask, to: TASKFLOW_BLOCKS.notifications, label: "emits" },
  { from: TASKFLOW_BLOCKS.taskList, to: TASKFLOW_BLOCKS.lifecycle, label: "states" },
];

export function canvasNeedsTaskflowSeed(editor: Editor) {
  return editor.getDocumentSettings().meta.formaSeedVersion !== SEED_VERSION;
}

export function seedTaskflow(editor: Editor) {
  if (!canvasNeedsTaskflowSeed(editor)) return;

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

export function connect(editor: Editor, fromId: TLShapeId, toId: TLShapeId, label: string) {
  const from = editor.getShapePageBounds(fromId);
  const to = editor.getShapePageBounds(toId);
  if (!from || !to) return;
  const id = createShapeId();
  editor.createShape({
    id,
    type: "arrow",
    x: from.midX,
    y: from.midY,
    props: {
      kind: "elbow",
      font: "sans",
      size: "s",
      start: { x: 0, y: 0 },
      end: { x: to.midX - from.midX, y: to.midY - from.midY },
      richText: toRichText(label),
    },
  });
  const bindingBase = {
    isExact: false,
    isPrecise: true,
    snap: "edge" as const,
  };
  editor.createBindings([
    {
      id: createBindingId(),
      type: "arrow",
      fromId: id,
      toId: fromId,
      props: {
        ...bindingBase,
        terminal: "start",
        normalizedAnchor: anchorBetween(from, to),
      },
    },
    {
      id: createBindingId(),
      type: "arrow",
      fromId: id,
      toId,
      props: {
        ...bindingBase,
        terminal: "end",
        normalizedAnchor: anchorBetween(to, from),
      },
    },
  ]);
}

function anchorBetween(shape: { midX: number; midY: number }, other: { midX: number; midY: number }) {
  const dx = other.midX - shape.midX;
  const dy = other.midY - shape.midY;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx > 0 ? 1 : 0, y: 0.5 };
  return { x: 0.5, y: dy > 0 ? 1 : 0 };
}
