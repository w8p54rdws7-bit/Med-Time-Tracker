/* Local-mode store: everything lives in this browser's localStorage,
 * synced between open tabs of the same browser via BroadcastChannel.
 * Same interface as cloudStore, so the app never knows the difference. */

const LS_PREFIX = "mtt.data.";

export function createLocalStore(householdId) {
  const key = LS_PREFIX + householdId;
  const channelName = "mtt-sync-" + householdId;
  let channel = null;
  let data = { people: [], meds: [], doses: [] };
  const listeners = new Set();

  function load() {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = {
          people: parsed.people || [],
          meds: parsed.meds || [],
          doses: parsed.doses || [],
        };
      }
    } catch (e) {
      console.error("Could not read local data", e);
    }
  }

  function persist() {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function emit() {
    for (const fn of [...listeners]) {
      try { fn(snapshot()); } catch (e) { console.error(e); }
    }
  }

  function write(mutator) {
    mutator();
    persist();
    emit();
    if (channel) {
      try { channel.postMessage({ type: "update" }); } catch (e) { /* tab closing race */ }
    }
  }

  function snapshot() {
    return {
      people: [...data.people],
      meds: [...data.meds],
      doses: [...data.doses],
    };
  }

  return {
    mode: "local",

    async init() {
      load();
      try {
        channel = new BroadcastChannel(channelName);
        channel.onmessage = (e) => {
          if (e.data && e.data.type === "update") {
            load();
            emit();
          }
        };
      } catch (e) {
        // BroadcastChannel unavailable → multi-tab sync disabled, single tab still works
        window.addEventListener("storage", (ev) => {
          if (ev.key === key) { load(); emit(); }
        });
      }
      return snapshot();
    },

    onSnapshot(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async savePerson(person) {
      write(() => {
        const i = data.people.findIndex((p) => p.id === person.id);
        if (i >= 0) data.people[i] = person; else data.people.push(person);
      });
    },

    async deletePerson(id) {
      write(() => {
        data.people = data.people.filter((p) => p.id !== id);
      });
    },

    async saveMed(med) {
      write(() => {
        const i = data.meds.findIndex((m) => m.id === med.id);
        if (i >= 0) data.meds[i] = med; else data.meds.push(med);
      });
    },

    async deleteMed(id) {
      write(() => {
        data.meds = data.meds.filter((m) => m.id !== id);
        data.doses = data.doses.filter((d) => d.medId !== id);
      });
    },

    async logDose(dose) {
      write(() => {
        const i = data.doses.findIndex((d) => d.id === dose.id);
        if (i >= 0) data.doses[i] = dose; else data.doses.push(dose);
      });
    },

    async deleteDose(id) {
      write(() => {
        data.doses = data.doses.filter((d) => d.id !== id);
      });
    },

    async replaceAll(next) {
      write(() => {
        data = { people: next.people || [], meds: next.meds || [], doses: next.doses || [] };
      });
    },
  };
}
