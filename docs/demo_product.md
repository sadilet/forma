# Demo Product: SlotGuard

**Status:** Canonical Forma showcase product for non-technical founders who want to build a **business**, not a hobby app.  
**Audience:** Founders, operators, and judges who need to see Market → Leads → Strategy Lock → Build in one story.  
**Related plan:** [`docs/plan.md`](./plan.md)

---

## 1. One-line pitch

**SlotGuard** helps local service businesses take online bookings with a **small refundable deposit**, so no-shows and late cancels stop emptying the calendar — and the business keeps the deposit when clients ghost.

---

## 2. Why SlotGuard is Forma's demo business

Forma's differentiator is not “AI wrote some screens.” It is connecting **market truth, paying customers, locked product decisions, and auditable software**. SlotGuard is designed so every Architect tab has a job:

| Forma capability | Why SlotGuard needs it |
| --- | --- |
| **Canvas sketch** | A non-engineer can draw booking, deposit, and owner dashboard without jargon. |
| **Market Research** | Crowded appointment software exists (Fresha, Mindbody, Calendly, Square Appointments). The founder must prove a **wedge**, not rebuild a salon OS. |
| **Lead Research** | Clear paying buyers: salon owners, clinic managers, tutors, studio owners. Leads are people you can call this week. |
| **Docs + Engineering Rigor** | Deposits imply payments, webhooks, refunds, and idempotency — standards and live docs matter. |
| **Strategy Lock** | Pricing *is* the product: deposit %, keep-vs-refund rules, and SaaS fee must be signed off before Build. |
| **Build + Entire audit** | MVP is small enough to ship in a demo, but serious enough that checkpoints (“deposit webhook,” “owner dashboard”) tell a business story. |

**Not chosen:** community favor boards or free neighborhood apps. Those undersell Market and Leads. SlotGuard is explicitly a **B2B revenue product** sold to small service businesses.

---

## 3. Founder persona (who “has the idea”)

**Name (demo):** Maya Chen  
**Background:** Non-technical. Ran a neighborhood yoga studio for three years; left after chronic no-shows killed evening classes.  
**Motivation:** Build a focused tool for businesses like hers — not a full scheduling suite.  
**Constraint:** Cannot hire a full engineering team for a prototype. Needs Forma to go from sketch → validated plan → clickable product she can show owners.  
**Success for Maya:** Ten discovery calls booked from Forma Leads, a locked pricing model, and a live booking + deposit preview she can demo on her phone.

---

## 4. Problem and business thesis

### Problem
Independent salons, clinics, tutors, and studios sell **time**. When a client no-shows or cancels late:
- The slot cannot be resold.
- Staff still get paid.
- Other clients were turned away.

Existing tools often optimize for **calendars and marketing**, not for **economic commitment at booking time**.

### Thesis
A thin product that does three things well can win a wedge:
1. Public booking link for one business.
2. Deposit collected at booking (card authorized or captured).
3. Clear rules: full refund if cancelled before cutoff; deposit kept (or partially kept) if late / no-show.

### Who pays
The **business owner** (SlotGuard’s customer), not the end client.  
Clients interact with SlotGuard only as bookers on a branded booking page.

### Revenue model options (to settle in Market + Strategy Lock)
| Option | Description | Demo default (pending lock) |
| --- | --- | --- |
| **A. SaaS subscription** | Flat monthly fee per location (e.g. €49/mo). | Preferred starting point for simplicity |
| **B. Take rate** | 1–3% of deposits processed. | Strong if Market shows owners hate another seat fee |
| **C. Hybrid** | Low SaaS + small payment fee. | Fallback if competitors undercut SaaS |

Open decision on the canvas: **Pricing model** (must be locked before Build).

---

## 5. Ideal customer profile (ICP)

### Target businesses
- Hair / nail salons and barbers with 1–5 chairs
- Independent physiotherapists, dental hygienists, aesthetic clinics
- Private tutors and coaches (music, language, tennis)
- Yoga / pilates / boutique fitness with drop-in or private slots

### Qualifying signals
- High demand + limited chairs/rooms
- Painful no-show rate (anecdotal 10–30% in service verticals)
- Already taking bookings via Instagram DMs, WhatsApp, or a basic calendar link
- Not locked into a heavy franchise POS

### Buyer roles (for Lead Research)
| Role | Why they matter |
| --- | --- |
| Owner / founder | Signs the subscription; feels the empty chair |
| Front-desk / studio manager | Lives the reschedule chaos; often champion |
| Multi-location operator (2–5 sites) | Expansion lead; higher ACV later |

### Geo for first demo run
Start with **one metro or country** (e.g. Helsinki / Finland, or a single US city) so Context.dev company/people queries stay specific and leads feel real.

---

## 6. Competitive landscape (what Market Research should surface)

Use these as seeds for Context.dev Market runs — not as final truth. The live report must cite sources.

| Competitor class | Examples | SlotGuard wedge |
| --- | --- | --- |
| Full salon / studio OS | Fresha, Mindbody, Vagaro | Too heavy; SlotGuard is deposit-first, calendar-light |
| Generic scheduling | Calendly, Google Calendar appointment slots | No deposit / no-show economics |
| Payments + booking | Square Appointments, Stripe Payment Links + calendar hacks | DIY; SlotGuard packages rules + owner dashboard |
| Deposit add-ons / waitlists | Various niche tools | Validate whether a pure “no-show deposit” niche already has a clear leader |

**Market questions Architect must answer**
1. Is no-show loss a top-3 pain for micro service businesses, or a nice-to-have?
2. What do owners already charge for late cancel (if anything)?
3. Will owners accept another monthly SaaS, or only a take rate?
4. Where is the differentiation vs Square/Fresha deposit features?

**Kill risks to name honestly**
- Incumbents add “require deposit” and erase the wedge.
- Chargebacks / disputes make deposit keeping legally or operationally painful.
- Owners won’t ask clients for deposits (culture / fear of losing bookings).

---

## 7. Product scope

### In scope for the Forma demo MVP
1. **Owner signup / simple login** (demo can be single seeded owner).
2. **Owner dashboard** — today’s appointments, deposit status (held / captured / refunded).
3. **Public booking page** — pick service, time slot, enter name/email/phone.
4. **Deposit checkout** — stub or test-mode payment; show “deposit held.”
5. **Cancel flow** — before cutoff → refund; after cutoff → keep deposit (rule visible to client).
6. **Notification stub** — email or in-app confirmation (SMS optional later).

### Explicitly out of scope for v1
- Full staff roster / shift management
- Inventory, memberships, marketing CRM
- Multi-location franchising
- Native mobile apps
- Marketplace of clients shopping across many salons

### North-star later (not demo-blocking)
- WhatsApp reminders
- Automatic slot reopening when deposit forfeited
- Payout reports and tax exports

---

## 8. Canonical Forma canvas (seed blueprint)

Use Forma block kinds: `note`, `decision`, `screen`, `service`, `database`, `entity`.

### Project goal (workspace goal field)

> SlotGuard helps local service businesses cut no-show losses by collecting a small refundable deposit at booking time. Owners get a booking link and a simple dashboard; clients see clear cancel rules. This canvas is the first pass: booking, deposits, refunds, and owner visibility. Pricing, payment provider, and deposit rules are still open.

### Blocks

#### Intent & commercial decisions (top row)

| Kind | Title | Description |
| --- | --- | --- |
| `note` | Product intent | Independent salons, clinics, tutors, and studios (1–5 chairs/rooms) lose money on no-shows. SlotGuard sells to the **owner**: booking link + deposit rules + dashboard. Not a full salon OS. |
| `decision` | Pricing model | Undecided: flat SaaS per location, % of deposits, or hybrid. Must be settled with Market Research before Strategy Lock. |
| `decision` | Deposit rules | Undecided: deposit amount (% of service vs fixed €), cancel cutoff (e.g. 24h), keep 100% vs partial on late cancel, no-show handling. |
| `decision` | Payments provider | Undecided: Stripe (cards / PaymentIntents) vs other. Affects webhooks, refunds, and Docs pack. |

#### Client-facing screens

| Kind | Title | Description |
| --- | --- | --- |
| `screen` | Public booking page | Client picks service and time, enters contact details, sees deposit amount and cancel policy before paying. |
| `screen` | Deposit checkout | Collects deposit; shows success and appointment summary. Failure and retry behavior not fully specified. |
| `screen` | Cancel / reschedule | Client cancels or reschedules; system applies refund vs keep rules based on cutoff. |

#### Owner-facing screens

| Kind | Title | Description |
| --- | --- | --- |
| `screen` | Owner dashboard | Lists today’s and upcoming appointments with deposit status (authorized, captured, refunded, forfeited). |
| `screen` | Services & availability | Owner defines services, prices, durations, and open hours. v1 can be minimal. |

#### Backend services & data

| Kind | Title | Description |
| --- | --- | --- |
| `service` | Booking engine | Creates appointments against availability; prevents double-booking. Concurrency rules open. |
| `service` | Deposit & refunds | Creates payment intents / charges; handles capture, refund, and forfeit per deposit rules. Webhook verification required. |
| `service` | Notifications | Sends booking confirmed, reminder, and cancel outcomes. Channel (email first) undecided for SMS. |
| `database` | SlotGuard store | Persists owners, services, slots, appointments, payment references, and audit of deposit state changes. |
| `entity` | Owner | The paying customer. Login, business profile, payout/settings later. |
| `entity` | Client | Booker; may be guest (email/phone only) in v1. |
| `entity` | Appointment | Service, time, client, deposit state machine. |

### Suggested connections (arrows)

```
Product intent → Pricing model (informs)
Product intent → Deposit rules (informs)
Pricing model → Owner dashboard (monetization)
Deposit rules → Deposit checkout (shows policy)
Deposit rules → Cancel / reschedule (applies policy)
Deposit rules → Deposit & refunds (implements)
Payments provider → Deposit & refunds (chooses)
Public booking page → Deposit checkout (continues)
Deposit checkout → Deposit & refunds (charges)
Deposit checkout → Booking engine (confirms slot)
Cancel / reschedule → Deposit & refunds (refund/forfeit)
Booking engine → SlotGuard store (writes)
Deposit & refunds → SlotGuard store (writes)
Owner dashboard → SlotGuard store (reads)
Services & availability → Booking engine (feeds)
Notifications ← Booking engine (events)
Owner → Owner dashboard
Client → Public booking page
Appointment → SlotGuard store
```

---

## 9. Architect flow for this product (scripted intents)

### 9.1 Review (gap analysis)
Expect findings around:
- Double-booking / concurrent booking
- Webhook failure and replay
- Chargeback / dispute path
- What the client sees when deposit is kept
- Auth for owner vs public booking page

### 9.2 Market
**Query framing for Context.dev**
- Companies: appointment booking software for salons/studios; deposit or no-show focused tools
- News: funding and feature launches in salon SaaS / SMB scheduling
- Pricing pages: Fresha, Mindbody, Square Appointments, Calendly — scrape for deposit/no-show language

**Outputs to pin before Lock**
- Demand verdict
- Competitor matrix with citations
- Recommended wedge + pricing recommendation applied to **Pricing model** decision block
- Named kill risks

### 9.3 Leads
**ICP query examples**
- Companies: independent hair salons / boutique fitness studios in [city] with small headcount
- People: “salon owners,” “studio managers,” “practice managers” in [country], 5+ years experience

**Lead card should include**
- Name, role, company, domain, profile URL
- Warm trigger (hiring, expansion, new location, tool migration news when available)
- Outreach angle tied to no-show deposits (2 sentences max)

**Demo success:** shortlist ≥ 5 leads; export CSV optional.

### 9.4 Docs + Engineering rigor
**Likely stack for Build**
- Next.js App Router, TypeScript
- SQLite or Postgres + Drizzle
- Stripe PaymentIntents (or chosen provider after decision)
- Simple email notifications

**Standards that must appear**
- Payment webhook signature verification
- Idempotent payment event handling
- Clear deposit state machine (authorized → captured / refunded / forfeited)
- PII retention for client contact fields
- Auth session hardening for owner dashboard

### 9.5 Strategy Lock checklist (SlotGuard-specific)
- [ ] Product intent note is specific (who pays, who books)
- [ ] Pricing model decision has a chosen option + Market citation
- [ ] Deposit rules decision has amount + cutoff + keep/refund policy
- [ ] Payments provider chosen
- [ ] Specs saved for: Public booking page, Deposit & refunds, Owner dashboard
- [ ] DocPack + Standards pack generated and pinned
- [ ] Residual risks acknowledged (chargebacks, incumbent copycat)

**Lock title example:** `SlotGuard — Strategy v1 (SaaS + 24h deposit rules)`

---

## 10. Build Studio acceptance (what “done” looks like in the demo)

### Must ship in Live Preview
1. Owner can open dashboard and see a seeded list of appointments with deposit statuses.
2. Client can open `/book/[ownerSlug]`, choose a slot, and complete a **test-mode** deposit checkout (or a convincingly stubbed success path labeled as test).
3. Cancel before cutoff marks deposit refunded; cancel after cutoff marks forfeited — status visible on dashboard.
4. At least one Entire (or local-git) checkpoint explains: *Deposit webhook / state machine* with citations from the Standards pack.

### Nice-to-have in the same session
- Human override: Maya edits copy on the booking page → human-attributed commit
- One-click rollback to pre-copy checkpoint
- ElevenLabs **Listen** on the Market report and Strategy Lock summary

---

## 11. End-to-end demo script (non-technical founder story)

**Runtime:** ~8–10 minutes  
**Cast:** Maya (founder) + optional collaborator on second browser

| Time | Beat | What to do | What to say |
| --- | --- | --- | --- |
| 0:00 | Hook | Show empty-ish SlotGuard canvas / seed | “I’m not an engineer. I lost revenue to no-shows. I want a business that fixes that — Forma is how I check the market and ship a first version.” |
| 0:45 | Sketch | Place/edit Product intent, Pricing, Deposit rules | “This is the whole product in boxes anyone can understand.” |
| 1:30 | Collaborate | Second cursor tweaks Deposit rules | “My co-founder can argue on the canvas with me in real time.” |
| 2:00 | Review | Analyze canvas | “Forma tells us what’s still unsafe to build — webhooks, disputes, double booking.” |
| 3:00 | Market | Run Market Research; pin report; update Pricing decision | “We’re not guessing. Here’s who already owns scheduling — and where our wedge is.” |
| 4:30 | Leads | Run Leads; shortlist 3 owners | “These are real people I can email tomorrow with a booking-link demo.” |
| 5:30 | Rigor | Docs + Standards; propose Deposit & refunds spec | “Deposits mean real payment rules — with citations, not vibes.” |
| 6:30 | Lock | Strategy Lock v1 | “I own this decision. Now we build.” |
| 7:00 | Build | Run Build; open Live Preview; book a test slot | “This is the product I’d show a salon owner.” |
| 8:30 | Audit | Open checkpoint + optional Listen | “Every change has a why — tied back to the canvas and the market.” |
| 9:30 | Close | | “Forma didn’t just write code. It helped me build a business plan I can defend.” |

---

## 12. Messaging do’s and don’ts

### Do
- Call SlotGuard a **business for service owners**
- Emphasize **who pays** (owner) vs who books (client)
- Let Market disagree with Maya — kill risks are a feature
- Keep the MVP embarrassingly narrow (deposits + dashboard)

### Don’t
- Position as “Uber for appointments” or a two-sided consumer marketplace
- Promise SMS, payroll, or inventory in the first Build
- Hide that payments/compliance are hard — Rigor exists for that
- Use Meeting Notes as the non-tech business story (keep Meeting Notes for B2B/technical audiences)

---

## 13. Implementation notes for the Forma repo

When engineering catches up to [`docs/plan.md`](./plan.md):

1. Add a workspace template `slotguard` alongside `taskflow` and `meetings`.
2. Seed the canvas blocks and arrows from **Section 8**.
3. Prefill project goal from **Section 8**.
4. Seed one sample Market/Leads prompt string in the Architect Market/Leads tabs for one-click demo runs.
5. Keep TaskFlow and Meeting Notes as secondary demos; **SlotGuard is the primary business narrative**.

### Suggested constants (for a future seed)

```ts
export const SLOTGUARD_PROJECT_ID = "project-slotguard";
export const SLOTGUARD_GOAL =
  "SlotGuard helps local service businesses cut no-show losses by collecting a small refundable deposit at booking time. Owners get a booking link and a simple dashboard; clients see clear cancel rules. Pricing, payment provider, and deposit rules are still open.";
```

---

## 14. Definition of locked

This document **locks SlotGuard** as Forma's canonical demo product for non-technical founders building a commercial venture. Product naming, ICP, wedge, canvas blueprint, Architect intents, Strategy Lock checklist, Build MVP, and demo script above are the source of truth until deliberately revised in a follow-up doc change.
