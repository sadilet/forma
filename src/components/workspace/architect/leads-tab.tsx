"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Editor } from "tldraw";
import { Chat } from "@/components/workspace/architect/chat";
import { ProposalList } from "@/components/workspace/architect/proposals";
import { Button, Input } from "@/components/ui";
import { extractCanvas } from "@/lib/canvas/extract";
import type { CanvasProposal } from "@/lib/ai/schemas";
import type { Citation } from "@/lib/research/citations";
import { inferLocale } from "@/lib/research/locale";
import { LEAD_STATUSES, type LeadBrief, type LeadStatus } from "@/lib/research/schemas";
import type { ProjectRecord } from "@/lib/projects";

type LeadRow = {
  id: string;
  personName: string;
  roleTitle: string;
  seniority: string;
  companyName: string;
  companyDomain: string;
  location: string;
  profileUrls: string[];
  warmTrigger: string;
  outreachAngle: string;
  status: LeadStatus;
  matchConfidence: number | null;
};

type LeadSession = {
  content: { proposals: CanvasProposal[] };
  citations: Citation[];
};

const EMPTY_BRIEF: LeadBrief = {
  targetCompanyQuery: "",
  buyerPersonaQuery: "",
  city: "",
  country: "",
  minExperienceYears: 5,
};

export function LeadsTab({
  editor,
  project,
  goal,
  refreshToken,
  chatToken,
}: {
  editor: Editor | null;
  project: ProjectRecord;
  goal: string;
  refreshToken: number;
  chatToken: number;
}) {
  const [brief, setBrief] = useState<LeadBrief | null>(null);
  const [assumption, setAssumption] = useState<boolean | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [session, setSession] = useState<LeadSession | null>(null);
  const [filter, setFilter] = useState<LeadStatus | "all">("all");
  const [running, setRunning] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inferred = canvasLocale(editor, goal);
  const shownBrief: LeadBrief = brief ?? {
    ...EMPTY_BRIEF,
    targetCompanyQuery: goal.slice(0, 180),
    buyerPersonaQuery: "owner or operator who feels this problem",
    city: inferred?.city ?? "",
    country: inferred?.country ?? "",
  };
  const assumed = assumption ?? Boolean(inferred?.assumed || inferred?.cityUnclear);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ai/research/leads?projectId=${project.id}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load leads.");
        if (cancelled) return;
        setLeads(data.leads ?? []);
        setSession(data.session ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load leads.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshToken]);

  async function draft() {
    if (!editor) return;
    setDrafting(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/research/leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, projectGoal: goal, canvas: extractCanvas(editor) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not draft the brief.");
      setBrief(data.brief);
      setAssumption(Boolean(data.locale?.assumed || data.locale?.cityUnclear));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not draft the brief.");
    } finally {
      setDrafting(false);
    }
  }

  async function run() {
    if (!editor || !shownBrief.city.trim() || !shownBrief.country.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/research/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, projectGoal: goal, canvas: extractCanvas(editor), brief: shownBrief }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Lead research failed.");
      setLeads(data.leads ?? []);
      setSession(data.session ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lead research failed.");
    } finally {
      setRunning(false);
    }
  }

  async function setStatus(lead: LeadRow, status: LeadStatus) {
    const response = await fetch("/api/ai/research/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, leadId: lead.id, status }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Could not update that lead.");
      return;
    }
    setLeads((current) => current.map((item) => (item.id === lead.id ? data.lead : item)));
  }

  const shown = leads.filter((lead) => filter === "all" || lead.status === filter);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="forma-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Companies
          <Input value={shownBrief.targetCompanyQuery} onChange={(event) => setBrief({ ...shownBrief, targetCompanyQuery: event.target.value })} />
        </label>
        <label className="mt-2 grid gap-1 text-xs text-muted-foreground">
          Buyer
          <Input value={shownBrief.buyerPersonaQuery} onChange={(event) => setBrief({ ...shownBrief, buyerPersonaQuery: event.target.value })} />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            City
            <Input value={shownBrief.city} onChange={(event) => { setAssumption(false); setBrief({ ...shownBrief, city: event.target.value }); }} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Country
            <Input value={shownBrief.country} onChange={(event) => { setAssumption(false); setBrief({ ...shownBrief, country: event.target.value }); }} />
          </label>
        </div>
        {assumed ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            The canvas does not name a clear place. Confirm the city and country, or change them, before finding people.
          </p>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="quiet" disabled={!editor || drafting} onClick={() => void draft()}>
            {drafting ? "Drafting…" : "Draft from canvas"}
          </Button>
          <Button variant="accent" disabled={!editor || running || !shownBrief.city.trim() || !shownBrief.country.trim()} onClick={() => void run()}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {running ? "Finding people" : "Find leads"}
          </Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Running again replaces this list. A follow-up should land the customer decision on the canvas.</p>
        {error ? <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger">{error}</p> : null}
        {leads.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
            {LEAD_STATUSES.map((status) => (
              <FilterChip key={status} active={filter === status} onClick={() => setFilter(status)}>
                {label(status)}
              </FilterChip>
            ))}
            <a className="ml-auto text-xs text-accent hover:underline" href={`/api/ai/research/leads?projectId=${project.id}&format=csv`}>
              Export CSV
            </a>
          </div>
        ) : null}
        <div className="mt-3 grid gap-2">
          {shown.map((lead) => (
            <article key={lead.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">{lead.personName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {[lead.roleTitle, lead.companyName, lead.location].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <select
                  aria-label={`Status for ${lead.personName}`}
                  value={lead.status}
                  onChange={(event) => void setStatus(lead, event.target.value as LeadStatus)}
                  className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
                >
                  {LEAD_STATUSES.map((status) => (
                    <option key={status} value={status}>{label(status)}</option>
                  ))}
                </select>
              </div>
              {lead.warmTrigger ? <p className="mt-2 text-sm leading-6">{lead.warmTrigger}</p> : null}
              {lead.outreachAngle ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{lead.outreachAngle}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {lead.profileUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Profile</a>
                ))}
                {lead.outreachAngle ? (
                  <button type="button" className="text-accent hover:underline" onClick={() => void navigator.clipboard.writeText(lead.outreachAngle)}>
                    Copy outreach
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        {session ? <ProposalList proposals={session.content.proposals} citations={session.citations} editor={editor} /> : null}
      </div>
      <Chat project={project} editor={editor} goal={goal} mode="leads" block={null} blockKey="__leads__" refreshToken={chatToken} />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-2.5 py-1 text-xs ${active ? "bg-accent-soft text-accent" : "text-muted-foreground hover:bg-surface-hover"}`}>
      {children}
    </button>
  );
}

function canvasLocale(editor: Editor | null, goal: string) {
  if (!editor) return null;
  const canvas = extractCanvas(editor);
  return inferLocale([goal, ...canvas.blocks.map((block) => `${block.title} ${block.description}`)].join("\n"));
}

function label(status: LeadStatus) {
  if (status === "new") return "New";
  if (status === "shortlisted") return "Shortlisted";
  if (status === "contacted") return "Contacted";
  return "Archived";
}
