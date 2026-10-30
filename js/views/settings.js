/* Settings: sync status + Firebase setup, household sharing, people and
 * medication management, data export/import. */

import { h, clear } from "../util/dom.js";
import {
  state, reinit, effectiveConfig, setConfigOverride, clearConfigOverride,
  getSnapshot, replaceAllData, addPerson, updatePerson, deletePersonCascade,
  saveMed, personById,
} from "../state.js";
import { createCloudStore } from "../store/cloudStore.js";
import { openSheet, confirmDialog, choiceDialog, toast } from "./components.js";
import { PERSON_COLORS } from "../util/id.js";
import { navigate } from "../router.js";

const APP_VERSION = "1.0.0";

export function render(content) {
  clear(content);
  content.appendChild(syncSection());
  content.appendChild(shareSection());
  content.appendChild(peopleSection());
  content.appendChild(medsSection());
  content.appendChild(dataSection());
  content.appendChild(h("div", { class: "muted", style: { textAlign: "center", fontSize: "13px", padding: "8px 0 20px" } },
    `Med Time Tracker ${APP_VERSION} — private household data, no accounts, no analytics.`));
}

/* ============================ sync ============================ */

function syncSection() {
  const sec = h("div", { class: "settings-section" });
  sec.appendChild(h("h2", null, "Sync"));

  if (state.mode === "cloud" && !state.initError) {
    sec.appendChild(h("div", { class: "settings-row" },
      h("div", { class: "settings-row__text" },
        h("div", { class: "settings-row__title" }, "Cloud sync"),
        h("div", { class: "settings-row__sub" }, "Every device with your share link sees the same timers and history, updating live."),
      ),
      h("span", { class: "status-pill" }, "● Synced"),
    ));
    sec.appendChild(h("div", { class: "settings-row" },
      h("div", { class: "settings-row__text" },
        h("div", { class: "settings-row__title" }, "Use a different Firebase project"),
        h("div", { class: "settings-row__sub" }, "Replaces the connection settings on this device."),
      ),
      h("button", { class: "btn btn--ghost btn--small", onclick: showConnectSheet }, "Change"),
    ));
    return sec;
  }

  sec.appendChild(h("div", { class: "settings-row" },
    h("div", { class: "settings-row__text" },
      h("div", { class: "settings-row__title" }, "Cloud sync"),
      h("div", { class: "settings-row__sub" }, state.initError
        ? `Cloud sync failed: ${state.initError} Data is currently stored on this device only.`
        : "Off — this device only. Turn on free real-time sync across your iPad and iPhones."),
    ),
    h("span", { class: `status-pill ${state.initError ? "status-pill--error" : "status-pill--local"}` },
      state.initError ? "● Error" : "● Local only"),
  ));
  sec.appendChild(h("button", { class: "btn btn--primary btn--block", onclick: showConnectSheet },
    "Turn on sync"));
  return sec;
}

function showConnectSheet() {
  const cfg = effectiveConfig();
  const textarea = h("textarea", {
    placeholder: `Paste the firebaseConfig object here, e.g.\n{\n  "apiKey": "AIza…",\n  "authDomain": "…",\n  "projectId": "…",\n  "appId": "…"\n}`,
  });
  if (cfg) textarea.value = JSON.stringify(cfg, null, 2);
  const err = h("div", { class: "err" });
  const busy = h("div", { class: "muted", style: { fontSize: "14px", minHeight: "20px" } });

  const body = h("div", null,
    h("p", { class: "muted", style: { fontSize: "14px" } },
      "One-time setup, about 5 minutes: create a free Firebase project, enable Anonymous sign-in and Firestore, then paste the web app config here. ",
      h("a", { href: "https://console.firebase.google.com", target: "_blank", rel: "noopener" }, "Open Firebase console ↗")),
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Firebase config (JSON)"),
      textarea,
      h("div", { class: "field__hint" }, "Firebase console → Project settings (⚙) → General → Your apps → Web app `</>` → SDK setup and configuration → Config."),
    ),
    err, busy,
    h("button", {
      class: "btn btn--primary btn--block",
      onclick: async () => {
        err.textContent = "";
        let cfgObj;
        try {
          const raw = textarea.value.trim().replace(/^[^{]*/, "").replace(/[^}]*$/, "");
          cfgObj = JSON.parse(raw);
        } catch (e) {
          err.textContent = "That doesn't look like the config JSON — copy the whole { … } block.";
          return;
        }
        if (!cfgObj.apiKey || !cfgObj.projectId) {
          err.textContent = "The config needs at least apiKey and projectId.";
          return;
        }
        busy.textContent = "Connecting…";
        try {
          await enableSync(cfgObj);
          sheet.close();
        } catch (e) {
          busy.textContent = "";
          err.textContent = String(e && e.message || e);
        }
      },
    }, "Connect & sync"),
  );

  const sheet = openSheet("Turn on cloud sync", body);
}

/* Connect with the given config, handling the merge cases:
 *  - cloud household missing → push this device's data up
 *  - cloud household exists  → ask: adopt cloud copy or overwrite with this device */
async function enableSync(cfgObj) {
  const prevOverride = localStorage.getItem("mtt.cfg");
  setConfigOverride(JSON.stringify(cfgObj));

  const revert = async () => {
    if (prevOverride == null) clearConfigOverride();
    else localStorage.setItem("mtt.cfg", prevOverride);
    await reinit();
  };

  const probe = createCloudStore(state.householdId, cfgObj);
  let exists;
  try {
    await probe.init({});
    exists = await probe.householdExists();
    if (!exists) {
      const snap = getSnapshot();
      if (snap.people.length || snap.meds.length || snap.doses.length) {
        await probe.pushAll(snap);
      }
    }
  } catch (e) {
    probe.dispose();
    await revert();
    throw e;
  }

  if (!exists) {
    probe.dispose();
    await reinit();
    toast("Sync enabled — open the share link on your other devices");
    return;
  }

  const local = getSnapshot();
  const hasLocal = local.people.length || local.meds.length || local.doses.length;
  if (hasLocal) {
    const choice = await choiceDialog("This household already exists in the cloud",
      "The cloud copy may hold data from another device. Which copy should this household use?",
      [
        { label: "Use cloud copy", value: "cloud", kind: "primary" },
        { label: "Push this device’s data", value: "push", kind: "ghost" },
        { label: "Cancel", value: null, kind: "ghost" },
      ]);
    if (choice === null) {
      probe.dispose();
      await revert();
      toast("Sync setup cancelled");
      return;
    }
    if (choice === "push") {
      await probe.pushAll(local);
    }
  }
  probe.dispose();
  await reinit();
  toast("Sync enabled");
}

/* ============================ sharing ============================ */

function shareSection() {
  const hid = state.householdId;
  const link = location.origin + location.pathname + "#/join/" + hid;
  return h("div", { class: "settings-section" },
    h("h2", null, "Sharing"),
    h("div", { class: "settings-row" },
      h("div", { class: "settings-row__text" },
        h("div", { class: "settings-row__title" }, "Invite a device"),
        h("div", { class: "settings-row__sub" }, "Open this link on an iPhone/iPad, then “Add to Home Screen”. It joins this household automatically."),
      ),
    ),
    h("code", { class: "codeblock" }, link),
    h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
      h("button", {
        class: "btn btn--primary btn--small",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast("Share link copied");
          } catch (e) {
            if (navigator.share) {
              navigator.share({ title: "Med Time Tracker", url: link }).catch(() => {});
            } else {
              toast("Copy failed — select the link above manually");
            }
          }
        },
      }, "Copy link"),
      navigator.share && h("button", {
        class: "btn btn--ghost btn--small",
        onclick: () => navigator.share({ title: "Med Time Tracker", url: link }).catch(() => {}),
      }, "Share…"),
    ),
    h("div", { class: "settings-row", style: { marginTop: "8px" } },
      h("div", { class: "settings-row__text" },
        h("div", { class: "settings-row__title" }, "Join another household"),
        h("div", { class: "settings-row__sub" }, "Switch this device to a different share link (replaces what you see here)."),
      ),
      h("button", { class: "btn btn--ghost btn--small", onclick: showJoinSheet }, "Switch"),
    ),
  );
}

function showJoinSheet() {
  const input = h("input", { type: "text", placeholder: "Paste a share link or household code", autocomplete: "off" });
  const err = h("div", { class: "err" });
  const body = h("div", null,
    h("div", { class: "field" },
      h("label", { class: "field__label" }, "Share link or code"),
      input,
    ),
    err,
    h("button", {
      class: "btn btn--primary btn--block",
      onclick: async () => {
        const m = input.value.trim().match(/([a-z0-9]{20,})\s*$/i);
        if (!m) { err.textContent = "Paste the full share link (or its 26-character code)."; return; }
        if (m[1] === state.householdId) { err.textContent = "You're already on this household."; return; }
        const ok = await confirmDialog("Switch household?",
          "This device will show the medications of the household you're joining. You can switch back anytime by opening your current share link.",
          { confirmLabel: "Switch" });
        if (!ok) return;
        sheet.close();
        await reinit(m[1]);
        navigate("#/");
      },
    }, "Switch"),
  );
  const sheet = openSheet("Join another household", body);
}

/* ============================ people ============================ */

function peopleSection() {
  const input = h("input", { type: "text", placeholder: "Add a person…", maxlength: "30" });
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    await addPerson(name);
    input.value = "";
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

  return h("div", { class: "settings-section" },
    h("h2", null, "People"),
    ...state.people.map((p) => {
      const medCount = state.meds.filter((m) => m.personId === p.id).length;
      return h("div", { class: "settings-row" },
        h("span", { class: "chip__dot", style: { background: colorHex(p), width: "14px", height: "14px", flexShrink: "0" } }),
        h("div", { class: "settings-row__text" },
          h("div", { class: "settings-row__title" }, p.name),
          h("div", { class: "settings-row__sub" }, `${medCount} medication${medCount === 1 ? "" : "s"}`),
        ),
        h("button", { class: "btn btn--ghost btn--small", onclick: () => showRenameSheet(p) }, "Rename"),
        h("button", {
          class: "btn btn--danger btn--small",
          onclick: async () => {
            const ok = await confirmDialog(`Delete ${p.name}?`,
              medCount
                ? `This also deletes their ${medCount} medication${medCount === 1 ? "" : "s"} and all dose history, on every device.`
                : "They'll be removed on every device.",
              { confirmLabel: "Delete", danger: true });
            if (!ok) return;
            try { await deletePersonCascade(p); toast(`${p.name} removed`); }
            catch (e) { toast("Delete failed — check connection"); }
          },
        }, "Delete"),
      );
    }),
    !state.people.length && h("div", { class: "muted", style: { fontSize: "14px" } }, "No people yet."),
    h("div", { style: { display: "flex", gap: "10px", marginTop: "10px" } },
      h("div", { style: { flex: "1" } }, input),
      h("button", { class: "btn btn--primary", onclick: add }, "Add"),
    ),
  );
}

function showRenameSheet(person) {
  const input = h("input", { type: "text", value: person.name, maxlength: "30" });
  const body = h("div", null,
    h("div", { class: "field" }, h("label", { class: "field__label" }, "Name"), input),
    h("button", {
      class: "btn btn--primary btn--block",
      onclick: async () => {
        const name = input.value.trim();
        if (!name) return;
        try { await updatePerson({ ...person, name }); } catch (e) { toast("Rename failed"); return; }
        sheet.close();
      },
    }, "Save"),
  );
  const sheet = openSheet("Rename person", body);
}

function colorHex(person) {
  const c = PERSON_COLORS.find((x) => x.name === person.colorName);
  return c ? c.hex : "var(--muted)";
}

/* ============================ medications ============================ */

function medsSection() {
  return h("div", { class: "settings-section" },
    h("h2", null, "Medications"),
    ...state.meds.map((med) => {
      const person = personById(med.personId);
      return h("div", { class: "settings-row" },
        h("div", { class: "settings-row__text" },
          h("div", { class: "settings-row__title" },
            `${med.name} ${med.active === false ? "· paused" : ""}`),
          h("div", { class: "settings-row__sub" },
            [person ? person.name : "", med.dosage, scheduleLabel(med)].filter(Boolean).join(" · ")),
        ),
        h("button", {
          class: "btn btn--ghost btn--small",
          onclick: async () => {
            await saveMed({ ...med, active: med.active === false });
          },
        }, med.active === false ? "Resume" : "Pause"),
        h("button", { class: "btn btn--ghost btn--small", onclick: () => navigate(`#/med/${med.id}`) }, "Edit"),
      );
    }),
    !state.meds.length && h("div", { class: "muted", style: { fontSize: "14px" } }, "No medications yet — add them from the dashboard."),
  );
}

function scheduleLabel(med) {
  if (med.scheduleType === "interval") {
    const m = med.intervalMinutes || 0;
    return m % 60 === 0 ? `every ${m / 60}h` : `every ${m}m`;
  }
  return (med.times || []).join(", ") || "no schedule";
}

/* ============================ data ============================ */

function dataSection() {
  const fileInput = h("input", { type: "file", accept: ".json,application/json", style: { display: "none" } });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.people) || !Array.isArray(data.meds) || !Array.isArray(data.doses)) {
          throw new Error("missing arrays");
        }
        const ok = await confirmDialog("Import this backup?",
          `Replaces the current household with ${data.people.length} people, ${data.meds.length} medications and ${data.doses.length} logged doses.`,
          { confirmLabel: "Import" });
        if (!ok) return;
        await replaceAllData(data);
        toast("Backup imported");
      } catch (e) {
        toast("That file isn't a Med Time Tracker backup");
      }
    };
    reader.readAsText(file);
  });

  return h("div", { class: "settings-section" },
    h("h2", null, "Data"),
    h("div", { class: "settings-row" },
      h("div", { class: "settings-row__text" },
        h("div", { class: "settings-row__title" }, "Export backup"),
        h("div", { class: "settings-row__sub" }, "Download everything as a JSON file."),
      ),
      h("button", {
        class: "btn btn--ghost btn--small",
        onclick: () => {
          const snap = getSnapshot();
          const blob = new Blob([JSON.stringify({
            app: "med-time-tracker",
            version: 1,
            householdId: state.householdId,
            exportedAt: new Date().toISOString(),
            ...snap,
          }, null, 2)], { type: "application/json" });
          const a = h("a", {
            href: URL.createObjectURL(blob),
            download: `med-time-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
          });
          document.body.appendChild(a);
          a.click();
          a.remove();
        },
      }, "Export"),
    ),
    h("div", { class: "settings-row" },
      h("div", { class: "settings-row__text" },
        h("div", { class: "settings-row__title" }, "Import backup"),
        h("div", { class: "settings-row__sub" }, "Restore from a backup file. Replaces current data everywhere."),
      ),
      h("button", { class: "btn btn--ghost btn--small", onclick: () => fileInput.click() }, "Import"),
    ),
    fileInput,
  );
}
