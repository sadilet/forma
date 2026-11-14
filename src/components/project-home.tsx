"use client";

import Link from "next/link";
import { useState } from "react";
import { createProject, logout } from "@/app/actions";
import { Logo } from "@/components/logo";
import { Button, Input, Modal } from "@/components/ui";
import type { SessionUser } from "@/lib/auth";
import type { ProjectTemplate } from "@/lib/canvas/kinds";
import type { ProjectRecord } from "@/lib/projects";
import { initials } from "@/lib/utils";

export function ProjectHome({ user, projects }: { user: SessionUser; projects: ProjectRecord[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("blank");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-[#101114]"
              style={{ background: user.color }}
            >
              {initials(user.name)}
            </span>
            {user.name}
          </span>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="mt-14 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open TaskFlow as Alex and Sam in two browsers to draw on the same canvas.
          </p>
        </div>
        <Button variant="primary" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setOpen(true)}>
          New workspace
        </Button>
      </div>

      <ul className="mt-6 divide-y divide-border border-y border-border">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/w/${project.id}`}
              className="flex items-center gap-4 py-4 transition-colors hover:bg-white/[0.03]"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{project.name}</span>
                  {project.template !== "blank" ? (
                    <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-muted-foreground">
                      Demo
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block truncate text-sm text-muted-foreground">
                  {project.goal || "Blank canvas"}
                </span>
              </span>
              <span className="text-sm text-muted-foreground">Open</span>
            </Link>
          </li>
        ))}
        {projects.length === 0 ? (
          <li className="py-8 text-sm text-muted-foreground">No workspaces yet.</li>
        ) : null}
      </ul>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="New workspace"
        description="Start from an empty canvas, or load a sample."
      >
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const result = await createProject({ name, template });
            if (result?.error) {
              setError(result.error);
              setPending(false);
            }
          }}
        >
          <label className="grid gap-1.5 text-sm">
            Name
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <TemplateChoice
              selected={template === "blank"}
              title="Blank"
              detail="Draw from scratch"
              onClick={() => setTemplate("blank")}
            />
            <TemplateChoice
              selected={template === "taskflow"}
              title="TaskFlow"
              detail="Sample product"
              onClick={() => setTemplate("taskflow")}
            />
            <TemplateChoice
              selected={template === "meetings"}
              title="Meeting Notes"
              detail="Sample product"
              onClick={() => setTemplate("meetings")}
            />
            <TemplateChoice
              selected={template === "slotguard"}
              title="SlotGuard"
              detail="Sample product"
              onClick={() => setTemplate("slotguard")}
            />
          </div>
          {error ? <p className="text-sm text-[#f0a3a8]">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={pending || name.trim().length === 0}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </Modal>
    </main>
  );
}

function TemplateChoice({
  selected,
  title,
  detail,
  onClick,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-3 text-left ${
        selected ? "border-accent/70 bg-accent/10" : "border-border hover:bg-white/[0.03]"
      }`}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}
