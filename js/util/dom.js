/* Tiny DOM builder: h('div', {class: 'x', onclick: fn}, 'text', childEl)
 * Props map to element properties; keys starting with "on" are event
 * listeners; "class" maps to className. Strings become text nodes. */

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2), value);
      } else if (key === "class") {
        el.className = value;
      } else if (key === "dataset") {
        Object.assign(el.dataset, value);
      } else if (key === "style" && typeof value === "object") {
        Object.assign(el.style, value);
      } else if (value === true) {
        el.setAttribute(key, "");
      } else {
        el[key] = value;
      }
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) {
      append(el, child);
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/* Escape-sensitive text for template use. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
