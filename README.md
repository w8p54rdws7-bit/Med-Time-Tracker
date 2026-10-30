# Med Time Tracker ⏱️💊

A medication tracker for households: live dose timers and full dose history, **identical on every device**. Built as an installable web app (PWA) — designed for iPad first, works great on iPhone, and opens on anything with a browser.

- **Two schedule types** — fixed daily times (e.g., 8:00 AM & 8:00 PM) and interval-based (e.g., every 6 hours from the last dose)
- **Live countdowns** — "Next dose in 2h 14m", pulsing "Due now", red "Overdue by 43m"
- **One-tap Taken** with undo, synced to every device within ~a second
- **Multiple people**, each color-coded, with their own medication list
- **Dose history** grouped by day, plus a 7-day adherence strip per medication
- **No accounts, no fees** — devices join via a private share link; data lives in your own free Firebase project (or on-device only)

---

## Track 1 — Use it right now (no setup)

Open `index.html` through any static web server, or just push this folder to any static host (GitHub Pages, Netlify drop, Firebase Hosting…). The app runs in **local mode**: fully functional, but data stays on that single device.

> ⚠️ Don't open `index.html` by double-clicking (a `file://` URL) — browsers block the features a PWA needs. Use one of the local server commands below, or a real host.

Local server options from this folder:

```
python -m http.server 8123            # then open http://localhost:8123
npx serve .                           # if you have Node
powershell -ExecutionPolicy Bypass -File tooling/serve.ps1    # Windows, no tools needed
```

## Track 2 — Turn on real-time sync across devices (~5 min, free)

Sync uses Google Firebase's free tier. You create one project; every device talks to it directly and updates live.

### Step 1 — Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Add project** (name it anything, e.g. `med-time-tracker`; Analytics can be off).
2. **Authentication** → **Get started** → **Sign-in method** → enable **Anonymous**. (The app signs each device in anonymously; your household link is the real gate.)
3. **Firestore Database** → **Create database** → pick a location → **Start in test mode**.
4. **Firestore Database → Rules** tab — replace everything with the rules below and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{hid} {
      allow get, create, update: if request.auth != null;
      match /{document=**} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

*(These rules require sign-in and keep household IDs — long random codes — unlistable. Someone must have your share link to reach your data.)*

5. **Project settings** (⚙ gear) → **General** → **Your apps** → **Web** (`</>`) → register (no hosting needed) → copy the `firebaseConfig` object shown.

### Step 2 — Point the app at it

**Easiest:** host the app (Step 3 below), open it, go to **Settings → Turn on sync**, and paste the config JSON into the box. Done — no file editing.

**Or bake it in:** open `js/config.js` and fill in the values from your config object. (The web config is not secret — it only identifies the project.)

### Step 3 — Publish to GitHub Pages (free hosting)

1. Push this repo to GitHub.
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → `main` / root → Save.
3. A minute later your app is at `https://<your-name>.github.io/med-time-tracker/` (or whatever the repo is named).

Any static host works; the app is plain files with no build step.

### Step 4 — Install on iPad and iPhones

1. **iPad (primary device):** open the site in Safari → set up your people and medications → **Share → Add to Home Screen**.
2. **iPhones:** on the iPad, open **Settings → Sharing → Copy link** and AirDrop/iMessage it. Opening the link joins your household automatically — then **Share → Add to Home Screen** there too.

Everything now stays in sync: mark a dose taken on the iPad and the iPhones update within about a second.

---

## How it works

| Piece | What it does |
|---|---|
| `index.html`, `css/`, `js/views/` | The app — plain ES modules, no build step, no dependencies at load |
| `js/store/localStore.js` | Local mode: `localStorage` + cross-tab sync |
| `js/store/cloudStore.js` | Cloud mode: Firestore real-time listeners (SDK loads from Google's CDN only when sync is on) |
| `js/util/time.js` | All scheduling math — next-dose computation, overdue states, adherence |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app + offline shell |
| `tooling/serve.ps1` | Tiny static server for Windows (dev) |
| `tooling/make-icons.ps1` | Regenerates the icons |

Notes:

- **Schedule times are in each device's local timezone** — intended for a household in one timezone.
- **Offline:** the last synced state is cached on each device, so the app opens and shows correct timers even without a network; changes sync when connection returns.
- **Backups:** Settings → Data → Export/Import (JSON), any time.
- **Timer check while testing:** add `?t=<epoch-ms>` to the URL to time-travel the countdowns (e.g., force an overdue state).

## Privacy

Medication data is stored in your own Firebase project, readable only by devices with your share link (a 26-character random ID that is part of the link — it's never sent to any server other than Google's, and the `#/join/…` fragment stays out of server logs). No analytics, no third parties.
