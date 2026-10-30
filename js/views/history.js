/* History: dose log grouped by day, filterable by person and date range,
 * plus a 7-day adherence strip for each fixed-schedule medication. */

import { h, clear } from "../util/dom.js";
import { state, personById, medById, undoDose } from "../state.js";
import { dayKey, dayLabel, fmtClock, adherenceForMed, sortedTimes } from "../util/time.js";
import { PERSON_COLORS } from "../util/id.js";
import { emptyState, toast, confirmDialog } from "./components.js";

let rangeDays = 7; // Today | 7 | 30 | all
let personFilter = "all";

export function render(content) {
  clear(content);
  content.appendChild(renderAdherence());
  content.appendChild(renderFilters());
  content.appendChild(renderLog());
}

/* ---------- adherence ---------- */

function renderAdherence() {
  const wrap = h("div");
  const meds = state.meds.filter((m) =>
    m.active !== false &&
    m.scheduleType === "fixed" &&
    sortedTimes(m).length &&
    (personFilter === "all" || m.personId === personFilter)
  );
  for (const med of meds) {
    const person = personById(med.personId);
    const days = adherenceForMed(med, state.doses, Date.now(), 7);
    wrap.appendChild(h("div", { class: "adherence" },
      h("div", { class: "adherence__head" },
        h("span", { class: "adherence__name" }, med.name),
        h("span", { class: "adherence__person" }, person ? person.name : ""),
      ),
      h("div", { class: "adherence__row" }, days.map((d) =>
        h("div", { class: "adherence__day" },
          h("div", { class: "adherence__dots" }, d.dots.map((dot) =>
            h("span", { class: `adot adot--${dot.state}`, title: `${d.dayKey} — ${dot.state}` })
          )),
          h("div", { class: "adherence__label" }, d.label),
        )
      )),
    ));
  }
  return wrap;
}

/* ---------- filters ---------- */

function renderFilters() {
  const options = [
    { label: "Today", days: 1 },
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "All", days: Infinity },
  ];
  return h("div", { class: "filterbar" },
    h("div", { class: "chips", style: { flex: 1, overflowX: "auto" } },
      h("button", {
        class: `chip ${personFilter === "all" ? "chip--active" : ""}`,
        onclick: () => { personFilter = "all"; rerender(); },
      }, "All"),
      ...state.people.map((p) =>
        h("button", {
          class: `chip ${personFilter === p.id ? "chip--active" : ""}`,
          style: { "--dot": colorHex(p) },
          onclick: () => { personFilter = p.id; rerender(); },
        }, h("span", { class: "chip__dot" }), p.name)
      ),
    ),
    h("div", { class: "segmented", style: { flexShrink: 0, minWidth: "260px" } },
      options.map((o) =>
        h("button", {
          class: rangeDays === o.days ? "seg--active" : "",
          onclick: () => { rangeDays = o.days; rerender(); },
        }, o.label)
      )
    ),
  );

  function rerender() {
    const content = document.getElementById("view");
    if (content) render(content);
  }
}

function colorHex(person) {
  if (!person) return "var(--muted)";
  const c = PERSON_COLORS.find((x) => x.name === person.colorName);
  return c ? c.hex : "var(--muted)";
}

/* ---------- dose log ---------- */

function renderLog() {
  const now = Date.now();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const cutoff = rangeDays === Infinity ? -Infinity : startOfDay.getTime() - (rangeDays - 1) * 86400000;

  const doses = state.doses
    .filter((d) => d.ts >= cutoff && (personFilter === "all" || d.personId === personFilter))
    .sort((a, b) => b.ts - a.ts);

  if (!doses.length) {
    return emptyState("📋", "No doses logged", "Doses marked as taken appear here, on every device.");
  }

  // group by local day, newest first
  const groups = [];
  let current = null;
  for (const dose of doses) {
    const dk = dayKey(dose.ts);
    if (!current || current.dayKey !== dk) {
      current = { dayKey: dk, ts: dose.ts, doses: [] };
      groups.push(current);
    }
    current.doses.push(dose);
  }

  const wrap = h("div");
  for (const g of groups) {
    wrap.appendChild(h("div", { class: "daygroup" },
      h("div", { class: "daygroup__title" },
        `${dayLabel(g.ts)} — ${g.doses.length} dose${g.doses.length > 1 ? "s" : ""}`),
      g.doses.map((dose) => historyRow(dose)),
    ));
  }
  return wrap;
}

function historyRow(dose) {
  const med = medById(dose.medId);
  const person = personById(dose.personId);
  return h("div", { class: "historyrow" },
    h("span", { class: "historyrow__time" }, fmtClock(dose.ts)),
    h("span", { style: { width: "4px", height: "28px", borderRadius: "2px", background: colorHex(person), flexShrink: "0" } }),
    h("div", { class: "historyrow__who" },
      h("span", { class: "historyrow__name" }, med ? med.name : "(deleted med)"),
      h("span", { class: "historyrow__med" }, [person ? person.name : "", dose.amount].filter(Boolean).join(" · ")),
    ),
    h("button", {
      class: "btn btn--ghost btn--small historyrow__undo",
      onclick: async () => {
        const ok = await confirmDialog("Remove this dose?",
          `${med ? med.name : "This dose"} at ${fmtClock(dose.ts)} will be removed on every device.`,
          { confirmLabel: "Remove", danger: true });
        if (!ok) return;
        try { await undoDose(dose.id); } catch (e) { toast("Remove failed — check connection"); }
      },
    }, "Remove"),
  );
}
