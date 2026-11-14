// SlotGuard reference build.
//
// Booking with a refundable deposit for small service businesses. This is the pre-built version of the
// canvas in docs/demo_product.md. It has no dependencies: Node's own http server and node:sqlite.
//
// Test mode: checkout never charges money. Every deposit is confirmed.
// The database lives in a temp file and is rebuilt with demo data on every start.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = Number(process.env.PORT) || 8080;
const DB_PATH = process.env.DB_PATH || "/tmp/slotguard.db";
const TZ = process.env.SHOP_TZ || "Europe/Helsinki";
const CUTOFF_HOURS = Number(process.env.CANCEL_CUTOFF_HOURS) || 24;
const PENDING_MINUTES = 15;
const OPEN_FROM = 9;
const OPEN_TO = 17;
const DAYS_AHEAD = 4;

// ---------- database ----------

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(DB_PATH + suffix, { force: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE owners (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, business TEXT NOT NULL, email TEXT NOT NULL);
  CREATE TABLE services (
    id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, name TEXT NOT NULL,
    price_cents INTEGER NOT NULL, deposit_cents INTEGER NOT NULL, minutes INTEGER NOT NULL
  );
  CREATE TABLE appointments (
    id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, owner_id INTEGER NOT NULL, service_id INTEGER NOT NULL,
    starts_at TEXT NOT NULL, client_name TEXT NOT NULL, client_email TEXT NOT NULL, client_phone TEXT NOT NULL,
    status TEXT NOT NULL,         -- pending, confirmed, cancelled, completed, no_show
    deposit_state TEXT NOT NULL,  -- none, held, refunded, forfeited, captured
    created_at INTEGER NOT NULL
  );
  -- One appointment per slot. A cancelled slot can be booked again.
  CREATE UNIQUE INDEX one_booking_per_slot ON appointments(owner_id, starts_at) WHERE status <> 'cancelled';
  CREATE TABLE deposit_audit (
    id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL,
    reason TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE notifications (id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, subject TEXT NOT NULL, at INTEGER NOT NULL);
`);

function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

// ---------- time ----------

function zoneParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

function zoneOffsetMs(date) {
  const p = zoneParts(date);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedToUtc(y, m, d, h) {
  const guess = Date.UTC(y, m, d, h);
  return new Date(guess - zoneOffsetMs(new Date(guess)));
}

const whenFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const when = (iso) => whenFormat.format(new Date(iso));
const dayKey = (date) => {
  const p = zoneParts(date);
  return `${p.y}-${p.m}-${p.d}`;
};

function openSlots(now = new Date()) {
  const base = zoneParts(now);
  const slots = [];
  for (let day = 0; day < DAYS_AHEAD; day += 1) {
    const date = new Date(Date.UTC(base.y, base.m - 1, base.d + day));
    for (let hour = OPEN_FROM; hour < OPEN_TO; hour += 1) {
      const start = zonedToUtc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour);
      if (start.getTime() > now.getTime() + 60 * 60 * 1000) slots.push(start.toISOString());
    }
  }
  return slots;
}

function freeSlots(ownerId) {
  expirePending();
  const taken = new Set(
    all("SELECT starts_at FROM appointments WHERE owner_id = ? AND status <> 'cancelled'", ownerId).map((row) => row.starts_at),
  );
  return openSlots().filter((slot) => !taken.has(slot));
}

// ---------- deposit state machine ----------
// none -> held (checkout) -> refunded | forfeited (cancel) | captured (visit done) | forfeited (no-show)
// Every change is written to deposit_audit.

function transition(id, fromStatus, toStatus, toDeposit, reason) {
  return transaction(() => {
    const row = one("SELECT deposit_state FROM appointments WHERE id = ? AND status = ?", id, fromStatus);
    if (!row) return false;
    run("UPDATE appointments SET status = ?, deposit_state = ? WHERE id = ?", toStatus, toDeposit, id);
    run(
      "INSERT INTO deposit_audit (appointment_id, from_state, to_state, reason, at) VALUES (?, ?, ?, ?, ?)",
      id, row.deposit_state, toDeposit, reason, Date.now(),
    );
    return true;
  });
}

function notify(email, subject) {
  run("INSERT INTO notifications (to_email, subject, at) VALUES (?, ?, ?)", email, subject, Date.now());
}

function expirePending() {
  run(
    "UPDATE appointments SET status = 'cancelled' WHERE status = 'pending' AND created_at < ?",
    Date.now() - PENDING_MINUTES * 60 * 1000,
  );
}

const refundable = (startsAt) => new Date(startsAt).getTime() - CUTOFF_HOURS * 3600 * 1000 > Date.now();

// ---------- demo data ----------

function seed() {
  run("INSERT INTO owners (slug, business, email) VALUES (?, ?, ?)", "maya-studio", "Maya's Studio", "maya@example.com");
  const services = [
    ["Haircut", 3500, 1000, 45],
    ["Colour", 9000, 2500, 120],
    ["Consultation", 2000, 500, 30],
  ];
  for (const [name, price, deposit, minutes] of services) {
    run("INSERT INTO services (owner_id, name, price_cents, deposit_cents, minutes) VALUES (1, ?, ?, ?, ?)", name, price, deposit, minutes);
  }
  const hour = 3600 * 1000;
  const now = Date.now();
  const rows = [
    // [service, offset from now, client, status, deposit]
    [1, 5 * hour, "Anna Virtanen", "confirmed", "held"],
    [2, 30 * hour, "Mika Laine", "confirmed", "held"],
    [3, 52 * hour, "Sofia Koskinen", "confirmed", "held"],
    [1, -26 * hour, "Jari Niemi", "completed", "captured"],
    [2, -50 * hour, "Eveliina Mäki", "cancelled", "refunded"],
    [1, -74 * hour, "Olli Heikkinen", "no_show", "forfeited"],
  ];
  rows.forEach(([service, offset, name, status, deposit], index) => {
    const startsAt = new Date(Math.round((now + offset) / 60000) * 60000).toISOString();
    const id = Number(
      run(
        `INSERT INTO appointments (token, owner_id, service_id, starts_at, client_name, client_email, client_phone,
           status, deposit_state, created_at) VALUES (?, 1, ?, ?, ?, ?, '', ?, ?, ?)`,
        `seed${index}`, service, startsAt, name, `${name.split(" ")[0].toLowerCase()}@example.com`, status, deposit, now,
      ).lastInsertRowid,
    );
    run(
      "INSERT INTO deposit_audit (appointment_id, from_state, to_state, reason, at) VALUES (?, 'none', ?, 'Demo data', ?)",
      id, deposit, now,
    );
  });
  notify("anna@example.com", "Booking confirmed: Haircut");
}
seed();

// ---------- html ----------

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const euro = (cents) => `€${(cents / 100).toFixed(2)}`;

const STATE_LABEL = {
  none: "No deposit", held: "Held", captured: "Captured", refunded: "Refunded", forfeited: "Forfeited",
};

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · SlotGuard</title>
<style>
  :root { color-scheme: light; --ink:#1b1d22; --muted:#667085; --line:#e4e7ec; --brand:#4f46e5; --bg:#f7f8fa; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--ink); background:var(--bg); }
  header { background:#fff; border-bottom:1px solid var(--line); }
  nav { max-width:880px; margin:0 auto; padding:14px 20px; display:flex; gap:18px; align-items:center; }
  nav a { color:var(--muted); text-decoration:none; font-size:14px; } nav a:hover { color:var(--ink); }
  nav .brand { color:var(--ink); font-weight:700; margin-right:auto; }
  main { max-width:880px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:26px; margin:0 0 6px; } h2 { font-size:17px; margin:30px 0 10px; }
  p { margin:0 0 12px; } .muted { color:var(--muted); font-size:14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px; margin:12px 0; }
  .test { background:#fff7e6; border:1px solid #ffd591; color:#7a4b00; border-radius:10px; padding:10px 14px; font-size:14px; margin:14px 0; }
  label { display:block; font-size:14px; font-weight:600; margin:14px 0 4px; }
  input, select { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px; font:inherit; background:#fff; }
  button { font:inherit; font-weight:600; padding:10px 16px; border-radius:8px; border:0; background:var(--brand); color:#fff; cursor:pointer; margin-top:16px; }
  button.quiet { background:#fff; color:var(--ink); border:1px solid var(--line); margin:0 6px 0 0; padding:6px 10px; font-size:13px; }
  button.danger { background:#b42318; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:14px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.04em; background:#fafbfc; }
  tr:last-child td { border-bottom:0; }
  .badge { display:inline-block; padding:2px 9px; border-radius:99px; font-size:12px; font-weight:600; }
  .held { background:#e0e7ff; color:#3730a3; } .captured { background:#d1fadf; color:#05603a; }
  .refunded { background:#e0f2fe; color:#075985; } .forfeited { background:#fee4e2; color:#b42318; } .none { background:#f2f4f7; color:#475467; }
  ul.plain { list-style:none; margin:0; padding:0; } ul.plain li { padding:6px 0; border-bottom:1px solid var(--line); font-size:14px; }
  form.inline { display:inline; }
</style></head><body>
<header><nav><a class="brand" href="/">SlotGuard</a><a href="/book/maya-studio">Book</a><a href="/dashboard">Owner dashboard</a><a href="/services">Services</a></nav></header>
<main>${body}</main></body></html>`;
  return { status, html };
}

const testBanner = `<div class="test"><strong>Test mode.</strong> Checkout never charges money. Every deposit is confirmed.</div>`;
const policyText = () =>
  `Cancel at least ${CUTOFF_HOURS} hours before the start and your deposit is refunded. Later than that, or if you do not show up, the studio keeps it.`;

function notFound() {
  return page("Not found", `<h1>Not found</h1><p class="muted">This page does not exist.</p>`, 404);
}

function home() {
  return page(
    "Home",
    `<h1>SlotGuard</h1>
<p class="muted">Booking with a refundable deposit, so no-shows stop costing local studios money.</p>
${testBanner}
<div class="card"><strong>For clients</strong><p class="muted">Book a time at Maya's Studio and see the deposit and cancel rules before you pay.</p><a href="/book/maya-studio">Open the booking page</a></div>
<div class="card"><strong>For the owner</strong><p class="muted">See today's appointments and what happened to every deposit.</p><a href="/dashboard">Open the dashboard</a></div>`,
  );
}

function servicesPage() {
  const owner = one("SELECT * FROM owners WHERE id = 1");
  const rows = all("SELECT * FROM services WHERE owner_id = 1 ORDER BY id")
    .map((s) => `<tr><td>${esc(s.name)}</td><td>${s.minutes} min</td><td>${euro(s.price_cents)}</td><td>${euro(s.deposit_cents)}</td></tr>`)
    .join("");
  return page(
    "Services",
    `<h1>Services &amp; availability</h1><p class="muted">${esc(owner.business)} · open ${OPEN_FROM}:00–${OPEN_TO}:00 (${esc(TZ)}), next ${DAYS_AHEAD} days.</p>
<table><tr><th>Service</th><th>Length</th><th>Price</th><th>Deposit</th></tr>${rows}</table>
<p class="muted" style="margin-top:14px">Editing services is not part of this first build.</p>`,
  );
}

function bookPage(slug, error = "") {
  const owner = one("SELECT * FROM owners WHERE slug = ?", slug);
  if (!owner) return notFound();
  const services = all("SELECT * FROM services WHERE owner_id = ? ORDER BY id", owner.id);
  const slots = freeSlots(owner.id);
  const serviceOptions = services
    .map((s) => `<option value="${s.id}">${esc(s.name)} · ${s.minutes} min · ${euro(s.price_cents)} · deposit ${euro(s.deposit_cents)}</option>`)
    .join("");
  const slotOptions = slots.map((slot) => `<option value="${esc(slot)}">${esc(when(slot))}</option>`).join("");
  return page(
    owner.business,
    `<h1>${esc(owner.business)}</h1><p class="muted">Pick a service and a time. You pay a small deposit now.</p>
${testBanner}
${error ? `<div class="test" style="background:#fee4e2;border-color:#fda29b;color:#912018">${esc(error)}</div>` : ""}
<form method="post" action="/book/${esc(owner.slug)}" class="card">
  <label for="service">Service</label><select id="service" name="service" required>${serviceOptions}</select>
  <label for="slot">Time</label><select id="slot" name="slot" required>${slotOptions || '<option value="">No free times</option>'}</select>
  <label for="name">Your name</label><input id="name" name="name" maxlength="80" required>
  <label for="email">Email</label><input id="email" name="email" type="email" maxlength="120" required>
  <label for="phone">Phone (optional)</label><input id="phone" name="phone" maxlength="30">
  <p class="muted" style="margin-top:16px"><strong>Cancel policy.</strong> ${esc(policyText())}</p>
  <button type="submit"${slotOptions ? "" : " disabled"}>Continue to deposit</button>
</form>`,
  );
}

function appointmentFor(token) {
  return one(
    `SELECT a.*, s.name AS service_name, s.deposit_cents, s.price_cents, o.business
     FROM appointments a JOIN services s ON s.id = a.service_id JOIN owners o ON o.id = a.owner_id
     WHERE a.token = ?`,
    token,
  );
}

function checkoutPage(token) {
  const a = appointmentFor(token);
  if (!a) return notFound();
  if (a.status !== "pending") return bookingPage(token);
  return page(
    "Deposit",
    `<h1>Pay your deposit</h1>${testBanner}
<div class="card"><strong>${esc(a.service_name)}</strong> at ${esc(a.business)}<br><span class="muted">${esc(when(a.starts_at))}</span>
<p style="margin-top:12px">Deposit: <strong>${euro(a.deposit_cents)}</strong> of ${euro(a.price_cents)}</p>
<p class="muted">${esc(policyText())}</p>
<form method="post" action="/checkout/${esc(token)}"><button type="submit">Pay ${euro(a.deposit_cents)} deposit (test mode)</button></form></div>
<p class="muted">The time is held for you for ${PENDING_MINUTES} minutes.</p>`,
  );
}

function bookingPage(token, note = "") {
  const a = appointmentFor(token);
  if (!a) return notFound();
  const audit = all("SELECT * FROM deposit_audit WHERE appointment_id = ? ORDER BY id", a.id)
    .map((row) => `<li>${esc(STATE_LABEL[row.to_state])} · ${esc(row.reason)}</li>`)
    .join("");
  const cancelBox =
    a.status === "confirmed"
      ? `<p class="muted">${refundable(a.starts_at) ? `If you cancel now your ${euro(a.deposit_cents)} deposit is refunded.` : `The cancel cutoff has passed. If you cancel now the studio keeps your ${euro(a.deposit_cents)} deposit.`}</p>
<form method="post" action="/booking/${esc(token)}/cancel"><button class="danger" type="submit">Cancel appointment</button></form>`
      : "";
  return page(
    "Your booking",
    `<h1>${a.status === "cancelled" ? "Booking cancelled" : a.status === "pending" ? "Almost done" : "You are booked"}</h1>
${note ? `<div class="test">${esc(note)}</div>` : ""}${testBanner}
<div class="card"><strong>${esc(a.service_name)}</strong> at ${esc(a.business)}<br><span class="muted">${esc(when(a.starts_at))} · ${esc(a.client_name)}</span>
<p style="margin-top:12px">Deposit: <span class="badge ${a.deposit_state}">${esc(STATE_LABEL[a.deposit_state])}</span> ${euro(a.deposit_cents)}</p>
${cancelBox}</div>${audit ? `<h2>Deposit history</h2><ul class="plain">${audit}</ul>` : ""}`,
  );
}

function dashboardPage() {
  expirePending();
  const rows = all(
    `SELECT a.*, s.name AS service_name, s.deposit_cents FROM appointments a JOIN services s ON s.id = a.service_id
     WHERE a.owner_id = 1 AND a.status <> 'pending' ORDER BY a.starts_at`,
  );
  const today = dayKey(new Date());
  const group = (a) => {
    const key = dayKey(new Date(a.starts_at));
    return key === today ? "today" : new Date(a.starts_at) > new Date() ? "upcoming" : "earlier";
  };
  const section = (name, title) => {
    const list = rows.filter((a) => group(a) === name);
    if (list.length === 0) return "";
    const body = list
      .map((a) => {
        const actions =
          a.status === "confirmed"
            ? `<form class="inline" method="post" action="/dashboard/${esc(a.token)}/complete"><button class="quiet">Mark done</button></form>
               <form class="inline" method="post" action="/dashboard/${esc(a.token)}/no-show"><button class="quiet">No-show</button></form>`
            : `<span class="muted">${esc(a.status.replace("_", " "))}</span>`;
        return `<tr><td>${esc(when(a.starts_at))}</td><td>${esc(a.service_name)}</td><td>${esc(a.client_name)}</td>
          <td><span class="badge ${a.deposit_state}">${esc(STATE_LABEL[a.deposit_state])}</span> <span class="muted">${euro(a.deposit_cents)}</span></td><td>${actions}</td></tr>`;
      })
      .join("");
    return `<h2>${title}</h2><table><tr><th>When</th><th>Service</th><th>Client</th><th>Deposit</th><th></th></tr>${body}</table>`;
  };
  const mails = all("SELECT * FROM notifications ORDER BY id DESC LIMIT 8")
    .map((n) => `<li>To ${esc(n.to_email)}: ${esc(n.subject)}</li>`)
    .join("");
  const totals = Object.fromEntries(
    all("SELECT deposit_state AS state, COUNT(*) AS n FROM appointments WHERE owner_id = 1 GROUP BY deposit_state").map((r) => [r.state, r.n]),
  );
  return page(
    "Dashboard",
    `<h1>Owner dashboard</h1><p class="muted">Maya's Studio · demo owner, no login in this build.</p>
<p class="muted">Held ${totals.held ?? 0} · Captured ${totals.captured ?? 0} · Refunded ${totals.refunded ?? 0} · Forfeited ${totals.forfeited ?? 0}</p>
${section("today", "Today")}${section("upcoming", "Upcoming")}${section("earlier", "Earlier")}
<h2>Notifications (stub, nothing is sent)</h2><ul class="plain">${mails || '<li class="muted">None yet.</li>'}</ul>`,
  );
}

// ---------- routes ----------

function readForm(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 16 * 1024) {
        // Stop keeping the data and answer 413. The connection is closed after the answer is sent.
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    });
    request.on("error", reject);
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function route(request, url) {
  const { method } = request;
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/api/health") {
    return { status: 200, json: { ok: true, service: "slotguard", mode: "test" } };
  }
  if (method === "GET" && parts.length === 0) return home();
  if (method === "GET" && url.pathname === "/services") return servicesPage();
  if (method === "GET" && url.pathname === "/dashboard") return dashboardPage();

  if (parts[0] === "book" && parts.length === 2) {
    if (method === "GET") return bookPage(parts[1]);
    if (method === "POST") {
      const owner = one("SELECT * FROM owners WHERE slug = ?", parts[1]);
      if (!owner) return notFound();
      const form = await readForm(request);
      const serviceId = Number(form.get("service"));
      const slot = String(form.get("slot") ?? "");
      const name = String(form.get("name") ?? "").trim();
      const email = String(form.get("email") ?? "").trim();
      const phone = String(form.get("phone") ?? "").trim().slice(0, 30);
      const service = one("SELECT * FROM services WHERE id = ? AND owner_id = ?", serviceId, owner.id);
      if (!service) return bookPage(parts[1], "Choose a service.");
      if (!name || name.length > 80) return bookPage(parts[1], "Enter your name.");
      if (!EMAIL.test(email) || email.length > 120) return bookPage(parts[1], "Enter a valid email.");
      if (!freeSlots(owner.id).includes(slot)) return bookPage(parts[1], "That time was just taken. Pick another.");
      const token = crypto.randomBytes(16).toString("hex");
      try {
        run(
          `INSERT INTO appointments (token, owner_id, service_id, starts_at, client_name, client_email, client_phone,
             status, deposit_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'none', ?)`,
          token, owner.id, service.id, slot, name, email, phone, Date.now(),
        );
      } catch {
        // The unique index closed the gap between the check above and the insert.
        return bookPage(parts[1], "That time was just taken. Pick another.");
      }
      return { status: 303, location: `/checkout/${token}` };
    }
  }

  if (parts[0] === "checkout" && parts.length === 2) {
    if (method === "GET") return checkoutPage(parts[1]);
    if (method === "POST") {
      const a = appointmentFor(parts[1]);
      if (!a) return notFound();
      // Test mode: the deposit is always confirmed. Confirming twice changes nothing the second time.
      if (transition(a.id, "pending", "confirmed", "held", "Deposit held (test mode, no money charged)")) {
        notify(a.client_email, `Booking confirmed: ${a.service_name}, ${when(a.starts_at)}`);
      }
      return { status: 303, location: `/booking/${parts[1]}` };
    }
  }

  if (parts[0] === "booking" && parts.length === 2 && method === "GET") return bookingPage(parts[1]);

  if (parts[0] === "booking" && parts[2] === "cancel" && parts.length === 3 && method === "POST") {
    const a = appointmentFor(parts[1]);
    if (!a) return notFound();
    const refund = refundable(a.starts_at);
    const changed = transition(
      a.id, "confirmed", "cancelled", refund ? "refunded" : "forfeited",
      refund ? `Cancelled before the ${CUTOFF_HOURS}h cutoff: refunded` : `Cancelled after the ${CUTOFF_HOURS}h cutoff: forfeited`,
    );
    if (changed) {
      notify(a.client_email, refund ? "Booking cancelled. Your deposit is refunded." : "Booking cancelled. Your deposit is kept.");
    }
    return { status: 303, location: `/booking/${parts[1]}` };
  }

  if (parts[0] === "dashboard" && parts.length === 3 && method === "POST") {
    const a = appointmentFor(parts[1]);
    if (!a) return notFound();
    if (parts[2] === "complete") transition(a.id, "confirmed", "completed", "captured", "Visit done: deposit captured");
    else if (parts[2] === "no-show") transition(a.id, "confirmed", "no_show", "forfeited", "No-show: deposit forfeited");
    else return notFound();
    return { status: 303, location: "/dashboard" };
  }

  return notFound();
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const result = await route(request, url);
    const headers = { "x-content-type-options": "nosniff", "cache-control": "no-store" };
    if (result.json) {
      response.writeHead(result.status, { ...headers, "content-type": "application/json" });
      response.end(JSON.stringify(result.json));
    } else if (result.location) {
      response.writeHead(result.status, { ...headers, location: result.location });
      response.end();
    } else {
      response.writeHead(result.status, { ...headers, "content-type": "text/html; charset=utf-8" });
      response.end(result.html);
    }
  } catch (error) {
    const tooLarge = error?.status === 413;
    if (!tooLarge) console.error(error);
    if (!response.headersSent) {
      response.writeHead(tooLarge ? 413 : 500, { "content-type": "text/plain", connection: "close" });
    }
    response.end(tooLarge ? "Request too large" : "Something went wrong", () => {
      if (tooLarge) request.destroy();
    });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`SlotGuard listening on ${PORT} (test mode)`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
