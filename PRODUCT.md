# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a non-technical founder with a business idea. Their situation is a pile of tabs: search, ChatGPT, Claude, Gemini, and a scatter of other products. They are trying to synthesize enough truth to test the idea. When they manage it, they leave with a demo.

Product and Engineering are the two seats beside that founder. A partner can join the same room. The founder is the person Forma speaks to, and the founder can move through the loop with the AI collaborator. Demo seats today are Alex Rivera (Product) and Sam Chen (Engineering).

## Product Purpose

Forma is the room where that founder does the work the tabs were doing. They sketch the idea, check it against the world, settle a spec, and build from that same context. Figuring out the product and building the product stay on one thread.

Success, in order:

1. A grounded demo they can put in front of real buyers: the spec, the market, the leads, and a running build that came from those decisions.
2. The same thread continues into production. The founder does not start over in another tool.

The public demo of Forma, and the product as it is sold, is one seamless landing page. That page communicates this vision correctly: the full thread, from the pile of tabs to a build the founder still directs. The destination clauses below stay visibly the destination.

## Positioning

Many products will build an app, and they start at the code. Engineers already have tools for code. Forma starts earlier, where the founder is trying to tell whether the idea is real, and the build is a consequence of that work.

The sell, in the founder's words:

> AI has changed how we write code, but building a product takes the same amount of time. Why? Because the bottleneck isn't writing functions anymore—it’s the fragmented context between market research, product specs, and engineering.
>
> Meet Forma: a real-time collaborative studio that takes you from idea to production in hours, not weeks.
>
> With Forma, you don't start with an empty repo. You sketch your idea, research competitors, validate the market, and pull real customer leads with your AI collaborator, grounded on the real world so that you are building for reality. Once the team aligns on the spec, you hit Build. Forma’s agents generate production-hardened code, maintain live documentation, and deploy to prod—complete with a full decision audit trail and one-click rollbacks. You stay in the driver's seat at every step to steer, edit, or override the system.
>
> We are moving past AI code assistants to redefine how entire software products are built.

That paragraph is the product being sold. Five clauses in it are the destination, still being built. A public page does not print them until the product does them:

- Idea to production in hours, not weeks.
- Production-hardened code.
- Live documentation.
- A full decision audit trail.
- One-click rollbacks.

"Grounded in the real world" means all of the following, and each one is non-negotiable:

- Named competitors, including where the wedge is.
- Real buyer leads the founder could actually contact.
- Current engineering docs and standards, so the build follows the world as it is.
- The founder can stop, edit, or override the system before anything ships.

## Operating Context

The founder opens one workspace. They sketch on a shared infinite canvas, with semantic blocks for the parts of the product. An AI collaborator in the same room researches the market, pulls leads, and grounds the engineering. Voice can sit on that canvas. When the spec is aligned, they hit Build. Deploy plans the app, writes it, checks it, and ships it to Google Cloud Run.

A second person joins by opening the same workspace in another browser. Without a Liveblocks key, the canvas stays on one browser and the product says so.

The public entry today is a demo login. `/` is the login screen. The landing page that demos and sells Forma does not exist yet.

## Capabilities and Constraints

In the product now:

- An infinite canvas with semantic blocks: screen, service, database, entity, decision, and note.
- Real-time collaboration when Liveblocks is configured: shared canvas, named cursors, presence.
- Architect, with four pillars: Review, Market, Leads, and Engineering.
- A bottom-of-canvas question bar that routes a question to the pillar it belongs to.
- Voice co-design on the canvas.
- Deploy to Google Cloud Run: plan, build, check, ship. The address stays stable across deploys. Cloud Run keeps the previous revision.
- Gemini by default, OpenAI when Gemini is not configured. Missing keys surface as an error. The product does not invent an answer.
- Demo sign-in only. There is no public registration, OAuth, or permission model. Any signed-in demo user can open any workspace.

Current limits, which are why the destination clauses above are not yet claimable:

- Apps Forma generates simulate payments, email, and SMS. They have no real login.
- There is no decision audit trail and no one-click rollback in the product. Both are specified in `docs/plan.md`.
- There is no live documentation surface.
- Nothing on hand measures "hours, not weeks."

## Brand Commitments

The product name is Forma.

The sell paragraph in Positioning is the binding statement of what Forma is selling. The landing page is how that statement is shown. It has to feel seamless, and it has to stay faithful to the vision, including which parts are still being built. Landing copy, variants, campaign lines, screenshots, outside captures, data, and the demo video live in `brand/`. This file holds the sell. It does not hold page copy.

No visual identity was made binding here.

## Evidence on Hand

- `docs/plan.md` — product architecture, including the intended audit trail and rollback work that is not built yet.
- `docs/deploy.md` — how a canvas becomes a checked service on Google Cloud Run.
- `docs/demo_product.md` — internal showcase narrative for SlotGuard, a deposit-booking idea for local service businesses.
- `docs/polish_live.md` — an internal UI plan. It includes a future public landing page. That page is not built.
- Seeded workspaces: SlotGuard, TaskFlow, and Meeting Notes, plus blank workspaces.
- Demo accounts: Alex Rivera (`alex@forma.dev`) and Sam Chen (`sam@forma.dev`).

Not on hand, and future work must not fabricate them: customer testimonials, named paying customers, pricing, usage metrics, and any measured time from idea to production. Outside screenshots and third-party data have not been collected.

## Product Principles

1. One context. Market research, the product spec, and engineering stay in the same room, and the build comes out of that room.
2. Grounded before it is built. Competitors and the wedge, real leads, and current engineering docs and standards are part of the work.
3. The founder drives. They can stop, edit, or override the system before anything ships.
4. One thread, two finishes. First a demo they can show a buyer. Then the same thread continues into production, without starting over in another tool.
5. The destination is earned. Production-hardened code, live documentation, a decision audit trail, one-click rollbacks, and hours rather than weeks stay off the page until the product does them.
