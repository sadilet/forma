"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Editor } from "tldraw";
import { Chat } from "@/components/workspace/architect/chat";
import { CitationLine, ProposalList } from "@/components/workspace/architect/proposals";
import { Button, Input } from "@/components/ui";
import { extractCanvas } from "@/lib/canvas/extract";
import { landWedge } from "@/lib/research/proposals";
import type { Citation } from "@/lib/research/citations";
import { inferLocale, type ResearchLocale } from "@/lib/research/locale";
import type { MarketReport, QueryMeta } from "@/lib/research/schemas";
import type { ProjectRecord } from "@/lib/projects";

type MarketPayload = {
  content: MarketReport;
  citations: Citation[];
  queryMeta: QueryMeta;
};

const VERDICT: Record<MarketReport["demandVerdict"], string> = {
  "strong-pull": "Strong pull",
  "crowded-wedge-needed": "Crowded, wedge needed",
  "unproven-niche": "Unproven niche",
  weak: "Weak pull",
};

export function MarketTab({
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
  const [override, setOverride] = useState<ResearchLocale | null>(null);
  const [report, setReport] = useState<MarketPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const place = override ?? canvasLocale(editor, goal);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ai/research/market?projectId=${project.id}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load market research.");
        if (!cancelled) setReport(data.report ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load market research.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshToken]);

  async function run() {
    if (!editor || !place?.city || !place.country) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/research/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          projectGoal: goal,
          canvas: extractCanvas(editor),
          city: place.city,
          country: place.country,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Market research failed.");
      setReport(data.report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Market research failed.");
    } finally {
      setRunning(false);
    }
  }

  const content = report?.content;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="forma-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            City
            <Input
              value={place?.city ?? ""}
              onChange={(event) => {
                setOverride({ ...(place ?? inferLocale("")), city: event.target.value, assumed: false, cityUnclear: false });
              }}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Country
            <Input
              value={place?.country ?? ""}
              onChange={(event) => {
                setOverride({ ...(place ?? inferLocale("")), country: event.target.value, assumed: false });
              }}
            />
          </label>
        </div>
        {place?.assumed ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            The canvas does not name a place. Research will use Helsinki, Finland unless you change it.
          </p>
        ) : null}
        {place?.cityUnclear ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            The canvas names {place.country || "a country"} and not a city. Add a city before running.
          </p>
        ) : null}
        <Button variant="accent" className="mt-3 w-full" disabled={!editor || running || !place?.city || !place.country} onClick={() => void run()}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {running ? "Reading the market" : "Run market research"}
        </Button>
        {running ? <p className="mt-2 text-xs leading-5 text-muted-foreground">This checks live sources and can take about a minute.</p> : null}
        {error ? <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger">{error}</p> : null}
        {content ? (
          <div className="mt-4 grid gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{VERDICT[content.demandVerdict]}</p>
            <p className="text-sm leading-6">{content.executiveSummary}</p>
            <section>
              <h3 className="text-sm font-medium">Wedge</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{content.recommendedWedge}</p>
              <CitationLine ids={content.wedgeCitationIds} citations={report.citations} />
            </section>
            {content.competitors.map((competitor) => (
              <article key={`${competitor.name}-${competitor.domain}`} className="rounded-xl border border-border p-3">
                <h3 className="text-sm font-medium">{competitor.name}</h3>
                <p className="text-xs text-muted-foreground">{[competitor.domain, competitor.headcount, competitor.fundingSummary].filter(Boolean).join(" · ")}</p>
                <p className="mt-2 text-sm leading-6">{competitor.positioning}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{competitor.pricingModel}</p>
                <CitationLine ids={competitor.citationIds} citations={report.citations} />
              </article>
            ))}
            {content.marketSignals.map((signal) => (
              <article key={signal.signal} className="rounded-xl border border-border p-3">
                <h3 className="text-sm font-medium">{signal.signal}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{signal.implication}</p>
                <CitationLine ids={signal.citationIds} citations={report.citations} />
              </article>
            ))}
            {content.killRisks.length > 0 ? (
              <section>
                <h3 className="text-sm font-medium">Kill risks</h3>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-6 text-muted-foreground">
                  {content.killRisks.map((risk) => (
                    <li key={risk.risk}>{risk.risk}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {report.queryMeta.failures.length > 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">{report.queryMeta.failures.join(" ")}</p>
            ) : null}
            <ProposalList
              proposals={
                editor
                  ? landWedge({
                      proposals: content.canvasProposals,
                      canvas: extractCanvas(editor),
                      citationIds: new Set(report.citations.map((citation) => citation.id)),
                      wedge: content.recommendedWedge,
                      wedgeCitationIds: content.wedgeCitationIds,
                    })
                  : content.canvasProposals
              }
              citations={report.citations}
              editor={editor}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Market research returns cited competitors, pricing, and a recommendation you can apply to a decision on the canvas.
          </p>
        )}
      </div>
      <Chat project={project} editor={editor} goal={goal} mode="market" block={null} blockKey="__market__" refreshToken={chatToken} />
    </div>
  );
}

function canvasLocale(editor: Editor | null, goal: string) {
  if (!editor) return null;
  const canvas = extractCanvas(editor);
  const text = [goal, ...canvas.blocks.map((block) => `${block.title} ${block.description}`)].join("\n");
  return inferLocale(text);
}
