"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { logout, updateProject } from "@/app/actions";
import { Logo } from "@/components/logo";
import { Button, Modal } from "@/components/ui";
import { LiveAvatars, LiveStatus } from "@/components/workspace/presence";
import type { SessionUser } from "@/lib/auth";
import type { ProjectRecord } from "@/lib/projects";
import { initials } from "@/lib/utils";
import { Sparkles } from "lucide-react";

export function TopNav({
  user,
  project,
  live,
  aiOpen,
  onToggleAi,
}: {
  user: SessionUser;
  project: ProjectRecord;
  live: boolean;
  aiOpen: boolean;
  onToggleAi: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [shareOpen, setShareOpen] = useState(false);

  async function saveName() {
    const next = name.trim();
    if (!next || next === project.name) {
      setName(project.name);
      return;
    }
    const result = await updateProject({ id: project.id, name: next });
    if (result?.error) toast.error(result.error);
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-[#0e0f12]/95 px-3">
      <Link href="/projects" className="shrink-0" aria-label="All workspaces">
        <Logo />
      </Link>
      <span className="h-4 w-px bg-white/10" />
      <input
        value={name}
        aria-label="Workspace name"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void saveName()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-40 bg-transparent text-sm font-medium outline-none sm:w-56"
      />
      <div className="ml-auto flex items-center gap-2">
        {live ? <LiveAvatars /> : <SoloAvatar user={user} />}
        <span className="hidden shrink-0 sm:block">
          {live ? <LiveStatus /> : <span className="whitespace-nowrap text-xs text-muted-foreground">Solo</span>}
        </span>
        <Button variant="quiet" size="sm" onClick={() => setShareOpen(true)}>
          Share
        </Button>
        <Button variant={aiOpen ? "accent" : "quiet"} size="sm" onClick={onToggleAi}>
          <Sparkles className="h-3.5 w-3.5" />
          Architect
        </Button>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} live={live} />
    </header>
  );
}

function SoloAvatar({ user }: { user: SessionUser }) {
  return (
    <span
      title={`${user.name} (you)`}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-[#101114]"
      style={{ background: user.color }}
    >
      {initials(user.name)}
    </span>
  );
}

function ShareDialog({
  open,
  onOpenChange,
  live,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  live: boolean;
}) {
  const url = typeof window === "undefined" ? "" : window.location.href;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Share this workspace"
      description={
        live
          ? "Sign in as the other demo user in a second browser, then open this link. Cursors, drawings, and selections sync live."
          : "Collaboration is not configured. Add LIVEBLOCKS_SECRET_KEY to .env.local and restart. Until then this canvas stays in this browser."
      }
    >
      <div className="grid gap-3">
        <code className="block overflow-hidden rounded-lg border border-border bg-black/30 px-3 py-2 text-xs text-muted-foreground">
          {url}
        </code>
        <Button
          variant="primary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
          }}
        >
          Copy link
        </Button>
        <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
          <p>Alex Rivera · alex@forma.dev</p>
          <p>Sam Chen · sam@forma.dev</p>
          <p>Password: demo</p>
        </div>
      </div>
    </Modal>
  );
}
