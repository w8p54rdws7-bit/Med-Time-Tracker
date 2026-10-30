/* Central app state: household identity, current snapshot, mode, filters.
 * The store (local or cloud) is the source of truth; this module caches the
 * last snapshot in localStorage so the UI renders instantly on load and even
 * offline in cloud mode. */

import { firebaseConfig } from "./config.js";
import { createLocalStore } from "./store/localStore.js";
import { createCloudStore } from "./store/cloudStore.js";
import { newHouseholdId, randomId, nextColor } from "./util/id.js";
import { slotToLog, slotKeyFor } from "./util/time.js";

const LS_HOUSEHOLD = "mtt.household";
const LS_FILTER = "mtt.filter";
const LS_CFG_OVERRIDE = "mtt.cfg";
const CACHE_PREFIX = "mtt.cache.";

const state = {
  ready: false,
  initError: null,      // fatal init error (e.g. bad Firebase config)
  syncError: null,      // transient subscription error → banner
  mode: "local",        // 'local' | 'cloud'
  householdId: null,
  people: [],
  meds: [],
  doses: [],
  filter: localStorage.getItem(LS_FILTER) || "all",
  store: null,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

export function effectiveConfig() {
  try {
    const raw = localStorage.getItem(LS_CFG_OVERRIDE);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && cfg.apiKey && cfg.projectId) return cfg;
    }
  } catch (e) { /* fall through to file config */ }
  if (firebaseConfig.apiKey && firebaseConfig.projectId) return firebaseConfig;
  return null;
}

export function setConfigOverride(cfgJson) {
  localStorage.setItem(LS_CFG_OVERRIDE, cfgJson);
}

export function clearConfigOverride() {
  localStorage.removeItem(LS_CFG_OVERRIDE);
}

function cacheKey(hid) { return CACHE_PREFIX + hid; }

function readCache(hid) {
  try {
    const raw = localStorage.getItem(cacheKey(hid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { people: parsed.people || [], meds: parsed.meds || [], doses: parsed.doses || [] };
  } catch (e) {
    return null;
  }
}

function writeCache() {
  try {
    localStorage.setItem(cacheKey(state.householdId), JSON.stringify({
      people: state.people, meds: state.meds, doses: state.doses,
    }));
  } catch (e) { /* storage full/blocked — cache is best-effort */ }
}

export function getSnapshot() {
  return { people: state.people, meds: state.meds, doses: state.doses };
}

/* ---------- boot ---------- */

export async function initApp() {
  // A #/join/<hid> link takes priority: the opener is joining that household.
  const joinMatch = location.hash.match(/^#\/join\/([a-z0-9]+)/i);
  if (joinMatch && joinMatch[1] !== localStorage.getItem(LS_HOUSEHOLD)) {
    localStorage.setItem(LS_HOUSEHOLD, joinMatch[1]);
    history.replaceState(null, "", location.pathname + location.search + "#/");
  }

  let hid = localStorage.getItem(LS_HOUSEHOLD);
  if (!hid) {
    hid = newHouseholdId();
    localStorage.setItem(LS_HOUSEHOLD, hid);
  }
  state.householdId = hid;

  const cached = readCache(hid);
  if (cached) {
    state.people = cached.people;
    state.meds = cached.meds;
    state.doses = cached.doses;
  }

  const cfg = effectiveConfig();
  if (cfg) {
    state.mode = "cloud";
    state.store = createCloudStore(hid, cfg);
  } else {
    state.mode = "local";
    state.store = createLocalStore(hid);
  }

  state.store.onSnapshot((snap) => {
    state.people = snap.people;
    state.meds = snap.meds;
    state.doses = snap.doses;
    writeCache();
    notify();
  });
  if (state.store.onError) {
    state.store.onError((msg) => {
      state.syncError = msg;
      notify();
      setTimeout(() => { state.syncError = null; notify(); }, 8000);
    });
  }

  try {
    const snap = await state.store.init({ migrateData: cached });
    state.people = snap.people;
    state.meds = snap.meds;
    state.doses = snap.doses;
    writeCache();
  } catch (e) {
    // Cloud init failed (bad config, no network, auth not enabled…).
    // Fall back to the local store so the app stays usable.
    console.error("Store init failed, falling back to local mode", e);
    if (state.store.dispose) state.store.dispose();
    state.mode = "local";
    state.store = createLocalStore(hid);
    state.store.onSnapshot((snap) => {
      state.people = snap.people;
      state.meds = snap.meds;
      state.doses = snap.doses;
      writeCache();
      notify();
    });
    state.initError = String(e && e.message || e);
    const snap = await state.store.init({});
    state.people = snap.people;
    state.meds = snap.meds;
    state.doses = snap.doses;
  }

  state.ready = true;
  notify();
}

/* Restart with a different household (join flow) or new config (settings). */
export async function reinit(householdIdOverride) {
  if (householdIdOverride) {
    localStorage.setItem(LS_HOUSEHOLD, householdIdOverride);
  }
  state.ready = false;
  state.initError = null;
  if (state.store && state.store.dispose) state.store.dispose();
  await initApp();
}

/* ---------- derived ---------- */

export function personById(id) { return state.people.find((p) => p.id === id) || null; }
export function medById(id) { return state.meds.find((m) => m.id === id) || null; }
export function activeMeds() { return state.meds.filter((m) => m.active !== false); }

/* ---------- mutations ---------- */

export function setFilter(f) {
  state.filter = f;
  localStorage.setItem(LS_FILTER, f);
  notify();
}

export async function addPerson(name) {
  const person = {
    id: randomId(10),
    name: name.trim(),
    colorName: nextColor(state.people).name,
    order: state.people.length,
    createdAt: Date.now(),
  };
  await state.store.savePerson(person);
  return person;
}

export async function updatePerson(person) {
  await state.store.savePerson({ ...person, name: person.name.trim() });
}

export async function deletePersonCascade(person) {
  const medIds = state.meds.filter((m) => m.personId === person.id).map((m) => m.id);
  for (const mid of medIds) await state.store.deleteMed(mid);
  await state.store.deletePerson(person.id);
  if (state.filter === person.id) setFilter("all");
}

export async function saveMed(med) {
  await state.store.saveMed(med);
}

export async function deleteMed(med) {
  await state.store.deleteMed(med.id);
}

export function takeDose(med) {
  const slot = med.scheduleType === "fixed" ? slotToLog(med, state.doses, Date.now()) : null;
  const dose = {
    id: randomId(14),
    medId: med.id,
    personId: med.personId,
    ts: Date.now(),
    slotKey: slot ? slotKeyFor(med.id, new Date(slot.dt), slot.hhmm) : null,
    amount: med.dosage || null,
  };
  return state.store.logDose(dose).then(() => dose);
}

export function undoDose(doseId) {
  return state.store.deleteDose(doseId);
}

export async function replaceAllData(next) {
  if (state.mode === "cloud") {
    await state.store.pushAll(next);
  } else {
    await state.store.replaceAll(next);
  }
  state.people = next.people || [];
  state.meds = next.meds || [];
  state.doses = next.doses || [];
  writeCache();
  notify();
}

export { state };
