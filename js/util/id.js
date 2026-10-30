/* Random identifier helpers. Client-generated IDs keep undo/delete trivial
 * with Firestore (we address docs directly instead of round-tripping server IDs). */

const ALPHABET = "abcdefghijkmnopqrstuvwxyz023456789";

export function randomId(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/* Household IDs are the only "secret" in the system — use extra length. */
export function newHouseholdId() {
  return randomId(26);
}

export const PERSON_COLORS = [
  { hex: "#e0533d", name: "red" },
  { hex: "#e78a2e", name: "orange" },
  { hex: "#c9a227", name: "gold" },
  { hex: "#3fa45b", name: "green" },
  { hex: "#2bb3a3", name: "teal" },
  { hex: "#3d7de0", name: "blue" },
  { hex: "#8a63f2", name: "purple" },
  { hex: "#d64f9a", name: "pink" },
];

export function nextColor(people) {
  const used = new Set(people.map((p) => p.colorName));
  const free = PERSON_COLORS.find((c) => !used.has(c.name));
  return free || PERSON_COLORS[people.length % PERSON_COLORS.length];
}
