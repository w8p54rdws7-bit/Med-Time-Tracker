/*
 * Firebase configuration for cloud sync.
 *
 * Until you fill this in, the app runs in "local mode": fully usable, but
 * data stays on the current device only. To enable free real-time sync
 * across your iPad and iPhones:
 *
 *   1. Go to https://console.firebase.google.com and create a project
 *      (any name, e.g. "med-time-tracker"). Analytics can be disabled.
 *   2. Project settings (gear icon) → General → "Your apps" → Web (</>)
 *      → register the app → copy the firebaseConfig object it shows.
 *   3. Paste the values below between the quotes.
 *   4. In the Firebase console: Authentication → Sign-in method →
 *      enable "Anonymous". Then Firestore Database → Create database →
 *      Start in test mode (or paste the rules from README.md).
 *
 * See README.md for the full walkthrough with every click.
 */
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};

/* Firestore SDK version pinned for offline caching. Bump only if needed. */
export const FIREBASE_SDK_VERSION = "11.6.0";
