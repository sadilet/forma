import type { CanvasSnapshot } from "../ai/schemas.ts";
import { formatFiles } from "./files.ts";
import type { FileSet } from "./files.ts";
import type { Llm, LlmMessage, LlmResult } from "./llm.ts";

// Helpers for the tests of the app builder: a small app the runtime accepts, and a model that plays back answers.

export function indexSource(title = "Studio", extraRoute = ""): string {
  return `export default function setup({ db, esc, html }) {
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  db.prepare("INSERT INTO items (name) VALUES (?)").run("Alpha <b>one</b>");
  const layout = (body, status = 200) => html('<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body><header><a href="/">Home</a> <a href="/about">About</a></header><main>' + body + '</main><footer>Demo build of ${title}. Nothing on these pages is real.</footer></body></html>', status);
  return {
    routes: [
      { method: "GET", path: "/", handler: () => layout("<h1>${title}</h1><ul>" + db.prepare("SELECT * FROM items").all().map((item) => "<li><a href='/items/" + item.id + "'>" + esc(item.name) + "</a></li>").join("") + "</ul>") },
      { method: "GET", path: "/about", handler: () => layout("<h1>About</h1><p>Assumptions: none.</p>") },
      { method: "GET", path: "/items/:id", handler: (ctx) => {
        const item = db.prepare("SELECT * FROM items WHERE id = ?").get(Number(ctx.params.id));
        return item ? layout("<h1>" + esc(item.name) + "</h1>") : layout("<h1>Not found</h1>", 404);
      } },${extraRoute}
    ],
    smoke: ["/", "/about", "/items/1"],
  };
}
`;
}

export const STYLE = "body { font-family: system-ui; margin: 0; }\n";

export function appFiles(title = "Studio"): FileSet {
  return { "app/index.mjs": indexSource(title), "public/style.css": STYLE };
}

export function answerOf(files: FileSet, summary = "Built the pages."): string {
  return `@@@ SUMMARY\n${summary}\n@@@ END\n${formatFiles(files)}\n`;
}

export type Call = { system: string; messages: LlmMessage[] };

// Plays the given answers one after another, then repeats the last one. Keeps what it was asked.
export function fakeLlm(replies: (string | LlmResult)[]): Llm & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    provider: "gemini",
    model: "fake-model",
    calls,
    async complete(request) {
      calls.push({ system: request.system, messages: structuredClone(request.messages) });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof reply === "string" ? { text: reply, truncated: false } : reply;
    },
  };
}

export const canvas: CanvasSnapshot = {
  blocks: [
    { id: "shape:page", kind: "screen", title: "Booking page", description: "Client picks a time." },
    { id: "shape:rules", kind: "decision", title: "Deposit rules", description: "20% of the price." },
    { id: "shape:store", kind: "database", title: "Store", description: "Persists everything." },
  ],
  connections: [
    { id: "1", fromId: "shape:page", toId: "shape:store", fromTitle: "Booking page", toTitle: "Store", label: "writes" },
    { id: "2", fromId: "shape:rules", toId: "shape:page", fromTitle: "Deposit rules", toTitle: "Booking page", label: "shown in" },
  ],
  sketches: [],
};
