/* One shared 1-second clock. Views subscribe and update only the DOM nodes
 * that show time (countdowns, slot chips) instead of re-rendering. */

const listeners = new Set();
let timer = null;
let last = 0;

export function onTick(fn) {
  listeners.add(fn);
  ensure();
  return () => listeners.delete(fn);
}

function ensure() {
  if (timer != null) return;
  last = Math.floor(Date.now() / 1000);
  timer = setInterval(() => {
    const sec = Math.floor(Date.now() / 1000);
    if (sec === last) return; // clock skew guard
    last = sec;
    for (const fn of [...listeners]) {
      try { fn(); } catch (e) { console.error("tick handler failed", e); }
    }
  }, 1000);
}
