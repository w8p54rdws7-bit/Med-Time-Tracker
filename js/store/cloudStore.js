/* Cloud store: real-time sync across devices via Google Firestore (free tier).
 * The Firebase SDK loads lazily from Google's CDN, so local-mode users never
 * download it. Documents live under households/{hid}/… where hid is an
 * unguessable shared-secret ID carried in the share link.
 *
 * Firestore security rules (paste in the Firebase console → Firestore → Rules):
 *
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /households/{hid} {
 *         allow get, create, update: if request.auth != null;
 *         match /{document=**} {
 *           allow read, write: if request.auth != null;
 *         }
 *       }
 *     }
 *   }
 */

import { FIREBASE_SDK_VERSION } from "../config.js";

const DOSE_QUERY_LIMIT = 1500;

export function createCloudStore(householdId, cfg) {
  let app = null;
  let db = null;
  let fs = null; // cached firestore module namespace
  let unsubs = [];
  const listeners = new Set();
  const errorListeners = new Set();
  let snap = { people: [], meds: [], doses: [] };
  const arrived = { people: false, meds: false, doses: false };

  function emit() {
    const complete = arrived.people && arrived.meds && arrived.doses;
    for (const fn of [...listeners]) {
      try { fn({ ...snap, complete }); } catch (e) { console.error(e); }
    }
  }

  function reportError(message, err) {
    console.error("[cloud]", message, err);
    for (const fn of [...errorListeners]) fn(message);
  }

  async function loadSdk() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`),
    ]);
    if (!fs) fs = fsMod;
    return { appMod, authMod, fsMod };
  }

  /* Firestore module namespace (loads lazily on first call). */
  async function fs_() {
    if (fs) return fs;
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    fs = await import(`${base}/firebase-firestore.js`);
    return fs;
  }

  function ref(name, id) {
    return fs.doc(db, "households", householdId, name, id);
  }

  return {
    mode: "cloud",

    async init({ migrateData } = {}) {
      const { appMod, authMod, fsMod } = await loadSdk();
      app = appMod.initializeApp(cfg, "mtt-" + householdId);
      const auth = authMod.getAuth(app);
      try {
        await authMod.signInAnonymously(auth);
      } catch (e) {
        throw new Error(
          "Anonymous sign-in failed. In the Firebase console, enable Authentication → Sign-in method → Anonymous. (" + e.code + ")"
        );
      }

      try {
        db = fsMod.initializeFirestore(app, {
          localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
        });
      } catch (e) {
        db = fsMod.getFirestore(app); // private-mode Safari etc.: no persistence
      }

      const houseRef = fsMod.doc(db, "households", householdId);
      const existing = await fsMod.getDoc(houseRef);
      if (!existing.exists()) {
        const batch = fsMod.writeBatch(db);
        batch.set(houseRef, { createdAt: Date.now() });
        for (const p of (migrateData && migrateData.people) || []) {
          batch.set(fsMod.doc(db, "households", householdId, "people", p.id), p);
        }
        for (const m of (migrateData && migrateData.meds) || []) {
          batch.set(fsMod.doc(db, "households", householdId, "meds", m.id), m);
        }
        for (const d of (migrateData && migrateData.doses) || []) {
          batch.set(fsMod.doc(db, "households", householdId, "doses", d.id), d);
        }
        await batch.commit();
      }

      const col = (name) => fsMod.collection(db, "households", householdId, name);

      unsubs.push(
        fsMod.onSnapshot(
          col("people"),
          (qs) => { snap.people = qs.docs.map((d) => d.data()); arrived.people = true; emit(); },
          (e) => reportError("People sync error — check Firestore rules.", e)
        ),
        fsMod.onSnapshot(
          col("meds"),
          (qs) => { snap.meds = qs.docs.map((d) => d.data()); arrived.meds = true; emit(); },
          (e) => reportError("Medication sync error — check Firestore rules.", e)
        ),
        fsMod.onSnapshot(
          fsMod.query(col("doses"), fsMod.orderBy("ts", "desc"), fsMod.limit(DOSE_QUERY_LIMIT)),
          (qs) => { snap.doses = qs.docs.map((d) => d.data()); arrived.doses = true; emit(); },
          (e) => reportError("Dose history sync error — check Firestore rules.", e)
        )
      );

      return { ...snap };
    },

    onSnapshot(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    onError(cb) {
      errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    },

    async householdExists() {
      const fsMod = await fs_();
      const d = await fsMod.getDoc(fsMod.doc(db, "households", householdId));
      return d.exists();
    },

    async savePerson(person) {
      const fsMod = await fs_();
      await fsMod.setDoc(ref("people", person.id), person);
    },

    async deletePerson(id) {
      const fsMod = await fs_();
      await fsMod.deleteDoc(ref("people", id));
    },

    async saveMed(med) {
      const fsMod = await fs_();
      await fsMod.setDoc(ref("meds", med.id), med);
    },

    async deleteMed(id) {
      const fsMod = await fs_();
      await fsMod.deleteDoc(ref("meds", id));
      // doses of this med are removed best-effort, one by one
      const orphanIds = snap.doses.filter((d) => d.medId === id).map((d) => d.id);
      for (const did of orphanIds) {
        await fsMod.deleteDoc(ref("doses", did));
      }
    },

    async logDose(dose) {
      const fsMod = await fs_();
      await fsMod.setDoc(ref("doses", dose.id), dose);
    },

    async deleteDose(id) {
      const fsMod = await fs_();
      await fsMod.deleteDoc(ref("doses", id));
    },

    /* Replace all cloud docs with `next` (used by import + "push this device's data"). */
    async pushAll(next) {
      const fsMod = await fs_();
      const batch = fsMod.writeBatch(db);
      const apply = (name, items) => {
        const keep = new Set(items.map((x) => x.id));
        for (const x of items) {
          batch.set(fsMod.doc(db, "households", householdId, name, x.id), x);
        }
        for (const old of snap[name]) {
          if (!keep.has(old.id)) {
            batch.delete(fsMod.doc(db, "households", householdId, name, old.id));
          }
        }
      };
      apply("people", next.people || []);
      apply("meds", next.meds || []);
      apply("doses", next.doses || []);
      await batch.commit();
    },

    dispose() {
      for (const u of unsubs) {
        try { u(); } catch (e) { /* already closed */ }
      }
      unsubs = [];
      if (app) {
        try { app.delete(); } catch (e) { /* ignore */ }
        app = null;
      }
    },
  };
}
