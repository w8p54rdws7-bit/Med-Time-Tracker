/* Medication add/edit form (bottom sheet over the dashboard). */

import { h } from "../util/dom.js";
import { state, saveMed, deleteMed } from "../state.js";
import { navigate, parseRoute } from "../router.js";
import { openSheet, confirmDialog, toast } from "./components.js";
import { randomId } from "../util/id.js";

export function render(_content, { id }) {
  const editing = id ? state.meds.find((m) => m.id === id) : null;

  // ---- local form state ----
  const draft = editing
    ? { ...editing, times: [...(editing.times || [])] }
    : {
        id: randomId(12),
        personId: state.filter !== "all" ? state.filter : (state.people[0] && state.people[0].id) || null,
        name: "",
        dosage: "",
        scheduleType: "fixed",
        times: ["08:00"],
        intervalMinutes: 360,
        notes: "",
        active: true,
        createdAt: Date.now(),
      };

  const errEl = h("div", { class: "err" });
  const body = h("form", { novalidate: true });

  // person picker
  const personRow = h("div", { class: "personpick" },
    state.people.map((p) =>
      h("button", {
        type: "button",
        class: `chip person-chip ${draft.personId === p.id ? "chip--active" : ""}`,
        dataset: { person: p.id },
        onclick: () => {
          draft.personId = p.id;
          for (const c of personRow.querySelectorAll(".chip")) c.classList.remove("chip--active");
          personRow.querySelector(`[data-person="${p.id}"]`).classList.add("chip--active");
        },
      }, p.name)
    ),
  );

  const nameInput = h("input", { type: "text", placeholder: "e.g., Amoxicillin", maxlength: "60", value: draft.name });
  const doseInput = h("input", { type: "text", placeholder: "e.g., 500 mg — 2 tablets", maxlength: "80", value: draft.dosage || "" });

  // ---- schedule type segmented control ----
  const fixedPanel = h("div");
  const intervalPanel = h("div");
  let timeRows = [];

  function renderTimeRows() {
    timeRows = [];
    fixedPanel.innerHTML = "";
    const rows = h("div", { class: "timerows" });
    draft.times.forEach((t, i) => {
      const row = h("div", { class: "timerow" },
        h("input", {
          type: "time", value: t,
          onchange: (e) => { draft.times[i] = e.target.value || "08:00"; },
        }),
        draft.times.length > 1 && h("button", {
          type: "button", class: "iconbtn", "aria-label": "Remove time",
          onclick: () => { draft.times.splice(i, 1); renderTimeRows(); },
        }, "🗑"),
      );
      timeRows.push(row);
      rows.appendChild(row);
    });
    fixedPanel.appendChild(rows);
    fixedPanel.appendChild(h("button", {
      type: "button", class: "btn btn--ghost btn--small",
      style: { marginTop: "8px" },
      disabled: draft.times.length >= 8,
      onclick: () => {
        draft.times.push("12:00");
        renderTimeRows();
      },
    }, "＋ Add another time"));
  }
  renderTimeRows();

  // whole hours are shown in hours; anything else (e.g. 90m, 45m) in minutes
  const wholeHours = (draft.intervalMinutes || 0) >= 60 && (draft.intervalMinutes || 0) % 60 === 0;
  const intervalCount = h("input", {
    type: "number", min: "1", step: "1",
    value: wholeHours ? draft.intervalMinutes / 60 : draft.intervalMinutes || 6,
  });
  const intervalUnit = h("select", null,
    h("option", { value: "60", selected: wholeHours }, "hours"),
    h("option", { value: "1", selected: !wholeHours }, "minutes"),
  );

  function showPanel() {
    fixedPanel.style.display = draft.scheduleType === "fixed" ? "" : "none";
    intervalPanel.style.display = draft.scheduleType === "interval" ? "" : "none";
  }

  const seg = h("div", { class: "segmented" },
    h("button", { type: "button", class: draft.scheduleType === "fixed" ? "seg--active" : "", onclick: () => { draft.scheduleType = "fixed"; syncSeg(); } }, "At set times"),
    h("button", { type: "button", class: draft.scheduleType === "interval" ? "seg--active" : "", onclick: () => { draft.scheduleType = "interval"; syncSeg(); } }, "Every few hours"),
  );
  function syncSeg() {
    seg.children[0].className = draft.scheduleType === "fixed" ? "seg--active" : "";
    seg.children[1].className = draft.scheduleType === "interval" ? "seg--active" : "";
    showPanel();
  }
  showPanel();

  intervalPanel.appendChild(h("div", { class: "inline-row" },
    h("div", { class: "field", style: { margin: 0 } },
      h("label", { class: "field__label" }, "Take every"),
      h("div", { class: "inline-row", style: { alignItems: "stretch" } },
        intervalCount,
        h("div", { class: "inline-row--narrow", style: { flex: "0 0 130px" } }, intervalUnit),
      ),
    ),
  ));

  const notesInput = h("textarea", { placeholder: "With food, refill date, pharmacy notes… (optional)", value: draft.notes || "" });
  const activeCheckbox = h("input", { type: "checkbox", checked: draft.active !== false, style: { width: "24px", height: "24px" } });

  body.append(
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Who takes it"),
      personRow,
    ),
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Medication name"),
      nameInput,
    ),
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Dosage"),
      doseInput,
      h("div", { class: "field__hint" }, "Shown on every device next to the timer."),
    ),
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Schedule"),
      seg,
      h("div", { style: { marginTop: "10px" } },
        fixedPanel,
        intervalPanel,
      ),
    ),
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Notes"),
      notesInput,
    ),
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Active"),
      h("label", { style: { display: "flex", alignItems: "center", gap: "10px", fontWeight: "600" } },
        activeCheckbox, "Show this medication on the dashboard"),
    ),
    errEl,
    h("div", { class: "medcard__actions" },
      editing && h("button", {
        type: "button", class: "btn btn--danger",
        onclick: async () => {
          const ok = await confirmDialog(`Delete ${draft.name || "this medication"}?`,
            "The medication and its entire dose history will be removed from every device.",
            { confirmLabel: "Delete", danger: true });
          if (!ok) return;
          try { await deleteMed(draft); } catch (e) { toast("Delete failed — check connection"); return; }
          sheet.close();
        },
      }, "Delete"),
      h("button", { type: "submit", class: "btn btn--primary", style: { flex: "1" } }, "Save"),
    ),
  );

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const name = nameInput.value.trim();
    if (!draft.personId) { errEl.textContent = "Choose who takes this medication."; return; }
    if (!name) { errEl.textContent = "Give the medication a name."; return; }
    if (draft.scheduleType === "fixed") {
      const times = [...new Set(draft.times.filter(Boolean))].sort();
      if (!times.length) { errEl.textContent = "Add at least one daily time."; return; }
      draft.times = times;
    } else {
      const n = Number(intervalCount.value);
      if (!Number.isFinite(n) || n <= 0) { errEl.textContent = "Enter how often it's taken."; return; }
      draft.intervalMinutes = Math.max(1, Math.round(n * Number(intervalUnit.value)));
    }
    draft.name = name;
    draft.dosage = doseInput.value.trim();
    draft.notes = notesInput.value.trim();
    draft.active = activeCheckbox.checked;
    try {
      await saveMed(draft);
    } catch (err) {
      errEl.textContent = "Save failed — check your connection and try again.";
      return;
    }
    sheet.close();
    toast(`${draft.name} saved`);
  });

  const sheet = openSheet(editing ? "Edit medication" : "Add medication", body, () => {
    if (parseRoute(location.hash).name === "med") navigate("#/");
  });
  return sheet;
}
