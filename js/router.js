/* Minimal hash router: #/ → dashboard, #/history, #/settings,
 * #/med/new and #/med/<id> → medication form sheet. */

export function parseRoute(hash) {
  const h = (hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "history") return { name: "history" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "med") return { name: "med", id: parts[1] === "new" ? null : parts[1] || null };
  return { name: "dashboard" };
}

export function navigate(hash) {
  if (location.hash === hash) {
    dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = hash;
  }
}
