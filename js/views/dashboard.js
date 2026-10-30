/* Dashboard: person filter chips + medication cards with live countdowns.
 * Countdown text updates every second in-place (no re-render); anything that
 * changes only when data changes (cards, chips, buttons) re-renders via state. */

import { h, clear } from "../util/dom.js";
import { medStatus, byUrgency, fmtClock, sortedTimes, now } from "../util/time.js";
import { onTick } from "../clock.js";
import { PERSON_COLORS } from "../util/id.js";
import { state, setFilter, activeMeds, personById, takeDose, undoDose, addPerson } from "../state.js";
import { navigate } from "../router.js";
import { toast, emptyState } from "./components.js";

let stopTick = null;

export function render(content) {
  if (stopTick) { stopTick(); stopTick = null; }

  clear(content);

  // First run: no people yet → friendly setup card
  if (!state.people.length) {
    content.appendChild(welcomeCard());
    return;
  }

  content.appendChild(renderBanner());
  content.appendChild(renderChips());
  content.appendChild(renderGrid());

  // Per-second in-place updates of countdowns and slot chips
  stopTick = onTick(() => {
    const t = now();
    for (const card of content.querySelectorAll(".medcard[data-med]")) {
      const med = state.meds.find((m) => m.id === card.dataset.med);
      if (!med) continue;
      patchCard(card, med, t);
    }
  });
}

export function destroy() {
  if (stopTick) { stopTick(); stopTick = null; }
}

/* ---------- banner ---------- */

function renderBanner() {
  if (state.mode === "cloud" && !state.initError) return h("span");
  const msg = state.initError
    ? `Cloud sync failed (${state.initError}) — running on this device only.`
    : "Sync not set up — this device only. Set up free multi-device sync in Settings.";
  return h("div", { class: "banner" }, "⚠️", h("span", null, msg),
    h("button", { onclick: () => navigate("#/settings") }, "Settings"));
}

/* ---------- person chips ---------- */

function renderChips() {
  const chips = h("div", { class: "chips" },
    h("button", {
      class: `chip ${state.filter === "all" ? "chip--active" : ""}`,
      onclick: () => setFilter("all"),
    }, "All"),
    ...state.people.map((p) =>
      h("button", {
        class: `chip ${state.filter === p.id ? "chip--active" : ""}`,
        style: { "--dot": colorHex(p) },
        onclick: () => setFilter(p.id),
      }, h("span", { class: "chip__dot" }), p.name)
    ),
  );
  return chips;
}

/* ---------- med grid ---------- */

function renderGrid() {
  const meds = activeMeds()
    .filter((m) => state.filter === "all" || m.personId === state.filter)
    .sort(byUrgency((m) => medStatus(m, state.doses, now())));

  if (!meds.length) {
    return emptyState("💊", "No medications yet", "Add the first medication to start tracking doses.",
      h("button", { class: "btn btn--primary", onclick: () => navigate("#/med/new") }, "＋ Add medication"));
  }

  const grid = h("div", { class: "medgrid" }, meds.map((med) => medCard(med)));

  const note = state.meds.some((m) => m.active === false)
    ? h("div", { class: "muted", style: { fontSize: "13px", padding: "6px 2px 0" } },
        "Paused medications are hidden — manage them in Settings.")
    : null;

  return h("div", null, grid, note,
    h("button", { class: "fab", onclick: () => navigate("#/med/new") }, "＋ Medication"));
}

function colorHex(person) {
  if (!person) return "var(--muted)";
  const c = PERSON_COLORS.find((x) => x.name === person.colorName);
  return c ? c.hex : "var(--muted)";
}

function medCard(med) {
  const t = now();
  const st = medStatus(med, state.doses, t);
  const person = personById(med.personId);
  const card = h("div", {
    class: "medcard",
    dataset: { med: med.id, state: st.state },
    style: { "--dot": colorHex(person) },
  });

  card.appendChild(h("div", { class: "medcard__head", onclick: () => navigate(`#/med/${med.id}`) },
    h("div", { class: "medcard__name" }, med.name),
    h("div", { class: "medcard__person" }, person ? person.name : ""),
  ));

  if (med.dosage) card.appendChild(h("div", { class: "medcard__dose" }, med.dosage));

  const headline = h("span", { class: "countdown__headline" }, st.headline);
  const countdown = h("div", { class: "countdown" },
    (st.state === "due" || st.state === "overdue") && h("span", { class: "pulse-dot" }),
    headline);
  card.appendChild(countdown);
  card.appendChild(h("div", { class: "countdown__label" }, st.sub));

  if (med.scheduleType === "fixed" && sortedTimes(med).length) {
    card.appendChild(slotRow(med, st));
  }

  card.appendChild(h("div", { class: "medcard__actions" },
    h("button", {
      class: "btn btn--success",
      style: { flex: "1" },
      onclick: () => markTaken(med),
    }, "✓ Taken"),
  ));

  return card;
}

function slotRow(med, st) {
  return h("div", { class: "slots" }, st.slots.map((s) =>
    h("span", {
      class: `slot slot--${s.state}`,
      dataset: { slottime: s.hhmm },
    }, s.state === "taken" ? "✓ " + fmtClock(s.dt) : fmtClock(s.dt))
  ));
}

/* Update only the time-dependent parts of an existing card. */
function patchCard(card, med, t) {
  const st = medStatus(med, state.doses, t);
  card.dataset.state = st.state;
  const headline = card.querySelector(".countdown__headline");
  const label = card.querySelector(".countdown__label");
  if (headline) headline.textContent = st.headline;
  if (label) label.textContent = st.sub;

  const slots = card.querySelector(".slots");
  if (slots) {
    for (const chip of slots.querySelectorAll(".slot")) {
      const match = st.slots.find((s) => s.hhmm === chip.dataset.slottime);
      if (match) {
        chip.className = `slot slot--${match.state}`;
        chip.textContent = (match.state === "taken" ? "✓ " : "") + fmtClock(match.dt);
      }
    }
  }
}

async function markTaken(med) {
  try {
    const dose = await takeDose(med);
    toast(`${med.name} — dose logged`, {
      actionLabel: "Undo",
      onAction: async () => {
        try { await undoDose(dose.id); } catch (e) { toast("Undo failed — check connection"); }
      },
    });
  } catch (e) {
    toast("Could not log dose — check your connection");
  }
}

/* ---------- first-run welcome ---------- */

function welcomeCard() {
  const input = h("input", {
    type: "text", placeholder: "e.g., Mom, Dad, Emma…", maxlength: "30",
    style: { flex: "1", minHeight: "48px", borderRadius: "12px", border: "1.5px solid var(--border)", background: "var(--surface-2)", padding: "0 14px", outline: "none" },
  });
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    await addPerson(name);
    input.value = "";
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  return emptyState("👋", "Welcome to Med Time Tracker",
    "Who needs medication reminders? Add the people taking medications — you can add more anytime.",
    h("div", { style: { display: "flex", gap: "10px", justifyContent: "center", maxWidth: "420px", margin: "0 auto" } },
      input,
      h("button", { class: "btn btn--primary", onclick: add }, "Add"),
    ));
}
