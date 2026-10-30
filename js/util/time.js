/* All dose-timing math lives here, as pure functions of (data, now).
 * Fixed-schedule meds: daily slot times ("HH:MM" in the device's local
 * timezone). Interval meds: next dose = last dose + interval.
 * A `?t=<epoch-ms|ISO>` URL parameter overrides "now" for testing. */

const TEST_NOW = (() => {
  const p = new URLSearchParams(location.search).get("t");
  if (!p) return null;
  const n = Number(p);
  if (!Number.isNaN(n) && p.trim() !== "") return n;
  const d = Date.parse(p);
  return Number.isNaN(d) ? null : d;
})();

export function now() {
  return TEST_NOW ?? Date.now();
}

/* ---------- formatting ---------- */

export function fmtDuration(ms) {
  const abs = Math.abs(ms);
  const totalMin = Math.round(abs / 60000);
  if (totalMin < 1) return "0m";
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

export function fmtClock(date) {
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dayKey(date) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function dayLabel(date) {
  const d = new Date(date);
  const today = new Date(now());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- slot helpers (fixed-schedule meds) ---------- */

export function atTime(date, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function slotKeyFor(medId, date, hhmm) {
  return `${medId}|${dayKey(date)}|${hhmm}`;
}

export function sortedTimes(med) {
  return [...(med.times || [])].sort();
}

/* Which slot should a "Taken" tap log, for a fixed-schedule med?
 * Catch up chronologically: earliest overdue slot if any, else next slot today.
 * Returns null when every slot today is already taken (extra dose). */
export function slotToLog(med, doses, nowMs) {
  const today = new Date(nowMs);
  const untaken = sortedTimes(med)
    .map((hhmm) => ({ hhmm, dt: atTime(today, hhmm) }))
    .filter((s) => !doses.some((d) => d.slotKey === slotKeyFor(med.id, today, s.hhmm)));
  if (!untaken.length) return null;
  const overdue = untaken.filter((s) => s.dt <= nowMs);
  if (overdue.length) return overdue[0];
  return untaken[0];
}

/* ---------- core status ---------- */

const DUE_WINDOW_MS = 60 * 1000; // "Due now" flash window at the exact due time

/* medStatus(med, doses, nowMs) →
 *  { state, dueAt, headline, sub, lastDoseAt, slots }
 *  state: 'ready' | 'ok' | 'due' | 'overdue' | 'done' | 'inactive'
 */
export function medStatus(med, doses, nowMs) {
  const medDoses = doses.filter((d) => d.medId === med.id);
  const lastDoseAt = medDoses.reduce((mx, d) => Math.max(mx, d.ts || 0), 0) || null;

  if (med.active === false) {
    return { state: "inactive", dueAt: null, headline: "Paused", sub: "Medication is inactive", lastDoseAt, slots: [] };
  }

  if (med.scheduleType === "interval") {
    const intervalMs = (med.intervalMinutes || 0) * 60000;
    if (!intervalMs || !lastDoseAt) {
      return { state: "ready", dueAt: null, headline: "As needed", sub: lastDoseAt ? "" : "No dose logged yet — timer starts at first dose", lastDoseAt, slots: [] };
    }
    const dueAt = lastDoseAt + intervalMs;
    return intervalStatus(dueAt, nowMs, lastDoseAt, med);
  }

  // fixed schedule
  const times = sortedTimes(med);
  if (!times.length) {
    return { state: "ready", dueAt: null, headline: "As needed", sub: "No schedule times set", lastDoseAt, slots: [] };
  }
  const today = new Date(nowMs);
  const slots = times.map((hhmm) => {
    const dt = atTime(today, hhmm);
    const taken = medDoses.some((d) => d.slotKey === slotKeyFor(med.id, today, hhmm));
    let s = "pending";
    if (taken) s = "taken";
    else if (dt <= nowMs && nowMs - dt < DUE_WINDOW_MS) s = "due";
    else if (dt <= nowMs) s = "overdue";
    return { hhmm, dt, taken, state: s };
  });
  const overdueSlots = slots.filter((s) => s.state === "overdue");
  if (overdueSlots.length) {
    const s = overdueSlots[overdueSlots.length - 1];
    return {
      state: "overdue", dueAt: s.dt,
      headline: `Overdue by ${fmtDuration(nowMs - s.dt)}`,
      sub: overdueSlots.length > 1 ? `${overdueSlots.length} doses waiting` : `Was due ${fmtClock(s.dt)}`,
      lastDoseAt, slots,
    };
  }
  const dueSlot = slots.find((s) => s.state === "due");
  if (dueSlot) {
    return { state: "due", dueAt: dueSlot.dt, headline: "Due now", sub: `Scheduled ${fmtClock(dueSlot.dt)}`, lastDoseAt, slots };
  }
  const nextToday = slots.find((s) => !s.taken);
  if (nextToday) {
    return {
      state: "ok", dueAt: nextToday.dt,
      headline: fmtDuration(nextToday.dt - nowMs),
      sub: `Next dose ${fmtClock(nextToday.dt)}`,
      lastDoseAt, slots,
    };
  }
  // all of today's slots taken → next is tomorrow's first slot
  const tomorrow = new Date(nowMs);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueAt = atTime(tomorrow, times[0]);
  return {
    state: "done", dueAt,
    headline: "All doses taken",
    sub: `Next ${fmtClock(dueAt)} tomorrow`,
    lastDoseAt, slots,
  };
}

function intervalStatus(dueAt, nowMs, lastDoseAt, med) {
  if (nowMs < dueAt && dueAt - nowMs > DUE_WINDOW_MS) {
    return { state: "ok", dueAt, headline: fmtDuration(dueAt - nowMs), sub: `Next dose ≈ ${fmtClock(dueAt)}`, lastDoseAt, slots: [] };
  }
  if (nowMs < dueAt) {
    return { state: "due", dueAt, headline: "Due now", sub: `Last dose ${fmtClock(lastDoseAt)}`, lastDoseAt, slots: [] };
  }
  return { state: "overdue", dueAt, headline: `Overdue by ${fmtDuration(nowMs - dueAt)}`, sub: `Was due ${fmtClock(dueAt)}`, lastDoseAt, slots: [] };
}

/* ---------- adherence (history view) ---------- */

const MISSED_GRACE_MS = 2 * 60 * 60 * 1000; // a slot counts "missed" 2h past its time

export function adherenceForMed(med, doses, nowMs, days = 7) {
  const times = sortedTimes(med);
  if (!times.length) return null;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(nowMs);
    date.setDate(date.getDate() - i);
    const beforeCreation = med.createdAt && dayKey(date) < dayKey(med.createdAt);
    const dots = times.map((hhmm) => {
      if (beforeCreation) return { state: "none" };
      const dt = atTime(date, hhmm);
      const taken = doses.some((d) => d.slotKey === slotKeyFor(med.id, date, hhmm));
      if (taken) return { state: "taken" };
      if (dt < nowMs - MISSED_GRACE_MS) return { state: "missed" };
      return { state: "pending" };
    });
    out.push({ dayKey: dayKey(date), label: date.toLocaleDateString([], { weekday: "narrow" }), dots });
  }
  return out;
}

/* Sort meds by urgency: overdue first, then soonest due; no-due last. */
export function byUrgency(statusOf) {
  return (a, b) => {
    const sa = statusOf(a), sb = statusOf(b);
    const rank = { overdue: 0, due: 1, ok: 2, ready: 3, done: 4, inactive: 5 };
    const ra = rank[sa.state], rb = rank[sb.state];
    if (ra !== rb) return ra - rb;
    if (sa.dueAt != null && sb.dueAt != null) return sa.dueAt - sb.dueAt;
    if (sa.dueAt != null) return -1;
    if (sb.dueAt != null) return 1;
    return 0;
  };
}
