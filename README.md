# Forma

Forma is a collaborative workspace for designing software on an infinite canvas. People draw together, select a component, and use an AI architect to turn the sketch into a specification.

## What it does

- Infinite canvas with select, pan, draw, sticky notes, rectangles, ellipses, arrows, and text
- Semantic blocks: screen, service, database, entity, decision, and note- Real-time collaboration through Liveblocks: shared canvas, named cursors, presence, and collaborator avatars
- AI Architect for the whole canvas: missing requirements, incomplete flows, and questions to discuss
- AI Explorer for the selected block, with streaming answers
- Specifications saved in SQLite, including AI proposals that stay unsaved until someone applies them
- Three demo canvases (SlotGuard, TaskFlow, Meeting Notes) plus blank workspaces
- Deploy: a model writes a working app from any canvas, the app is checked, and a worker puts it online on Google Cloud Run. Deploy again after editing the canvas and the app is updated. See [docs/deploy.md](docs/deploy.md)

## Requirements

- Node.js 26 (see `.nvmrc`)
- An OpenAI API key or a Gemini API key for AI features
- A Liveblocks secret key for collaboration across browsers

The app still runs without those keys. AI routes return a configuration error. Without Liveblocks, the canvas is local to one browser and the interface says so. Forma does not simulate other people's cursors.

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | For AI | Server-side OpenAI access. Used when Gemini is not configured, or when `AI_PROVIDER=openai`. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4.1-mini`. |
| `GEMINI_API_KEY` | For AI | Server-side Gemini access. Used by default when it is set. |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash`. |
| `AI_PROVIDER` | No | `gemini` or `openai`. Empty uses Gemini when its key is present, otherwise OpenAI. |
| `LIVEBLOCKS_SECRET_KEY` | For collaboration | Secret key from [liveblocks.io](https://liveblocks.io). |
| `SESSION_SECRET` | No | Signs the session cookie. Defaults to a local demo secret. |
| `DATABASE_PATH` | No | SQLite file. Defaults to `data/forma.db`. |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | No | Removes the tldraw watermark. |

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The first launch creates `data/forma.db` and seeds two users plus the TaskFlow workspace.

## Demo accounts

| Name | Email | Password | Cursor |
| --- | --- | --- | --- |
| Alex Rivera | alex@forma.dev | demo | Blue |
| Sam Chen | sam@forma.dev | demo | Orange |

## Two-browser collaboration

1. Set `LIVEBLOCKS_SECRET_KEY` and restart the dev server.
2. In browser A, sign in as Alex and open TaskFlow.
3. In browser B, sign in as Sam and open the same TaskFlow link (Share copies it).
4. Draw in both windows. Cursors, names, and shapes should move together.
5. Select Login and choose Explore.
6. Ask a question, then open Specification. Login already has a saved spec.
7. Choose Propose an update, review it, then Apply.
8. Switch the architect to Canvas and run Analyze canvas.

Blank workspaces are available from New workspace. They are not prefilled.

## Scripts

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run db:push
```

`db:push` is optional. The server creates tables on startup.

## Limitations

- Collaboration requires a Liveblocks project. There is no self-hosted sync server.
- AI requires Gemini or OpenAI. If the chosen key or model is wrong, the sidebar shows the error instead of a fake answer. Set `AI_PROVIDER=openai` to use OpenAI while a Gemini key is also present.
- Without a tldraw license key, the canvas shows the tldraw watermark.
- There is no account registration, OAuth, or permission model. Any signed-in demo user can open any workspace.
- Canvas geometry lives in Liveblocks when collaboration is on, and in this browser's IndexedDB when it is not. Turning collaboration on later does not import the solo drawing.
- The architect suggests. It never edits the canvas or saves a specification on its own.
