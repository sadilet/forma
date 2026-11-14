"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Editor } from "tldraw";
import { Chat } from "@/components/workspace/architect/chat";
import { CitationLine } from "@/components/workspace/architect/proposals";
import { Button } from "@/components/ui";
import { runPipeline } from "@/lib/architect/pipelines";
import { TAB_BLOCK_KEY } from "@/lib/architect/tabs";
import { extractCanvas } from "@/lib/canvas/extract";
import type { Citation } from "@/lib/research/citations";
import type { DocPack, StandardsPack } from "@/lib/research/schemas";
import type { ProjectRecord } from "@/lib/projects";

type Stored<T> = { content: T; citations: Citation[] };

export function EngineeringTab({
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
  const [docs, setDocs] = useState<Stored<DocPack> | null>(null);
  const [standards, setStandards] = useState<Stored<StandardsPack> | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/build/grounding/docs?projectId=${project.id}`).then((response) => response.json()),
      fetch(`/api/build/grounding/standards?projectId=${project.id}`).then((response) => response.json()),
    ])
      .then(([docsData, standardsData]) => {
        if (cancelled) return;
        setDocs(docsData.pack ?? null);
        setStandards(standardsData.pack ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load engineering grounding.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshToken, reload]);

  async function run() {
    if (!editor) return;
    setRunning(true);
    setNotice(null);
    setError(null);
    const result = await runPipeline("engineering", { projectId: project.id, goal, canvas: extractCanvas(editor) });
    setNotice(result.notice);
    setReload((count) => count + 1);
    setRunning(false);
  }

  const titles = new Map(editor ? extractCanvas(editor).blocks.map((block) => [block.id, block.title]) : []);
  const grounded = docs !== null || standards !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="forma-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <Button variant="accent" className="mt-1 w-full" disabled={!editor || running} onClick={() => void run()}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {running
            ? "Reading docs and standards"
            : grounded
              ? "Refresh docs and standards"
              : "Ground docs and standards"}
        </Button>
        {running ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            This checks official documentation and security guidance and can take about a minute.
          </p>
        ) : null}
        {notice ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{notice}</p> : null}
        {error ? (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-danger">
            {error}
          </p>
        ) : null}

        {grounded ? (
          <div className="mt-4 grid gap-3">
            {docs ? (
              <section className="grid gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Documentation</p>
                <p className="text-sm leading-6">{docs.content.summary}</p>
                {docs.content.packages.map((item) => (
                  <article key={item.packageName} className="rounded-xl border border-border p-3">
                    <h3 className="text-sm font-medium">{item.packageName}</h3>
                    <p className="text-xs text-muted-foreground">{item.versionOrEra}</p>
                    {item.breakingChangesAndDeprecations.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-muted-foreground">
                        {item.breakingChangesAndDeprecations.map((change) => (
                          <li key={change}>{change}</li>
                        ))}
                      </ul>
                    ) : null}
                    <CitationLine ids={item.citationIds} citations={docs.citations} />
                  </article>
                ))}
              </section>
            ) : null}
            {standards ? (
              <section className="grid gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Standards</p>
                <p className="text-sm leading-6">{standards.content.summary}</p>
                {standards.content.standards.map((standard) => (
                  <article key={standard.id} className="rounded-xl border border-border p-3">
                    <h3 className="text-sm font-medium">{standard.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {[
                        standard.category,
                        ...standard.appliesToBlockIds.map((id) => titles.get(id)).filter(Boolean),
                      ].join(" · ")}
                    </p>
                    {standard.mustHoldInvariants.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-muted-foreground">
                        {standard.mustHoldInvariants.map((invariant) => (
                          <li key={invariant}>{invariant}</li>
                        ))}
                      </ul>
                    ) : null}
                    <CitationLine ids={standard.citationIds} citations={standards.citations} />
                  </article>
                ))}
              </section>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Engineering grounding reads the official docs for your stack and the security standards your components
            touch, with sources, so the build starts from facts.
          </p>
        )}
      </div>
      <Chat
        project={project}
        editor={editor}
        goal={goal}
        mode="engineering"
        block={null}
        blockKey={TAB_BLOCK_KEY.engineering}
        refreshToken={chatToken}
      />
    </div>
  );
}
