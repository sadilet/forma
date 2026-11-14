import "server-only";

import { describeSpecification } from "@/lib/ai/prompt";
import { TAB_BLOCK_KEY, TAB_META, type ArchitectTab } from "@/lib/architect/tabs";
import { listConversationThreads, listSpecifications } from "@/lib/projects";
import { researchPrompt } from "@/lib/research/prompt-context";
import type { ContextScope } from "@/lib/voice/protocol";

// What Gemini Live can pull when it asks for deeper context. It reuses the same text the chat routes give the
// architect, so a spoken answer and a typed answer rest on the same saved research.

const TAIL = 8;
const PILLARS: ArchitectTab[] = ["review", "market", "leads", "engineering"];

type Thread = { key: string; label: string; messages: { role: string; content: string }[] };

export async function buildWorkspaceContext(projectId: string, scope: ContextScope, blockId?: string) {
  const threads = await listConversationThreads(projectId);
  const out: Record<string, unknown> = { scope };

  const wantsPillar = (tab: ArchitectTab) => scope === "all" || scope === tab;
  for (const tab of PILLARS) {
    if (!wantsPillar(tab)) continue;
    out[tab] = {
      saved: await researchPrompt(projectId, tab),
      discussion: tail(threads, TAB_BLOCK_KEY[tab], TAB_META[tab].label),
    };
  }

  if (scope === "all" || scope === "specifications") {
    out.specifications = (await listSpecifications(projectId)).map((entry) => ({
      blockId: entry.blockId,
      specification: describeSpecification(entry.specification),
    }));
  }

  if (scope === "component") {
    if (!blockId) return { scope, error: "Pass blockId to read a component." };
    const spec = (await listSpecifications(projectId)).find((entry) => entry.blockId === blockId);
    out.blockId = blockId;
    out.specification = spec ? describeSpecification(spec.specification) : "No specification has been saved yet.";
    out.discussion = tail(threads, blockId, "Component");
  }

  if (scope === "all") {
    out.componentDiscussions = threads
      .filter((thread) => thread.blockId && !Object.values(TAB_BLOCK_KEY).includes(thread.blockId))
      .map((thread) => ({ blockId: thread.blockId, messages: thread.messages.slice(-TAIL).map(trim) }));
  }
  return out;
}

function tail(threads: Awaited<ReturnType<typeof listConversationThreads>>, key: string, label: string): Thread {
  const thread = threads.find((item) => item.blockId === key);
  return { key, label, messages: (thread?.messages ?? []).slice(-TAIL).map(trim) };
}

function trim(message: { role: string; content: string }) {
  return { role: message.role, content: message.content.slice(0, 1200) };
}
