/* Shared UI pieces: toasts, bottom sheets, confirm dialogs, empty states. */

import { h } from "../util/dom.js";

export function toast(message, { actionLabel, onAction, duration = 5000 } = {}) {
  const root = document.getElementById("toast-root");
  const el = h("div", { class: "toast" },
    h("span", null, message),
    actionLabel && h("button", {
      class: "toast__action",
      onclick: () => { onAction && onAction(); dismiss(); },
    }, actionLabel),
  );
  const dismiss = () => { el.remove(); };
  root.appendChild(el);
  setTimeout(dismiss, duration);
  return dismiss;
}

/* Bottom sheet over the current view. `onClose` fires on every close path
 * (backdrop tap, ✕ button, or programmatic close). Returns { close }. */
export function openSheet(title, bodyEl, onClose) {
  const backdrop = h("div", { class: "sheet-backdrop" });
  const close = () => {
    backdrop.remove();
    sheet.remove();
    onClose && onClose();
  };
  backdrop.addEventListener("click", close);
  const sheet = h("div", { class: "sheet" },
    h("div", { class: "sheet__grab" }),
    h("div", { class: "sheet__head" },
      h("div", { class: "sheet__title" }, title),
      h("button", { class: "iconbtn", onclick: close, "aria-label": "Close" }, "✕"),
    ),
    h("div", { class: "sheet__body" }, bodyEl),
  );
  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  return { close };
}

/* Promise-based confirm dialog. Resolves true/false. */
export function confirmDialog(title, message, { confirmLabel = "Confirm", danger = false } = {}) {
  return choiceDialog(title, message, [
    { label: "Cancel", value: false, kind: "ghost" },
    { label: confirmLabel, value: true, kind: danger ? "danger" : "primary" },
  ]);
}

/* Promise-based multi-choice dialog. Buttons: {label, value, kind}. Resolves the
 * chosen value, or null if dismissed. */
export function choiceDialog(title, message, buttons) {
  return new Promise((resolve) => {
    const close = (val) => { backdrop.remove(); resolve(val); };
    const backdrop = h("div", { class: "dialog-backdrop" },
      h("div", { class: "dialog" },
        h("h3", null, title),
        h("p", null, message),
        h("div", { class: "dialog__actions" },
          buttons.map((b) =>
            h("button", {
              class: `btn btn--${b.kind || "ghost"}`,
              onclick: () => close(b.value),
            }, b.label)
          ),
        ),
      ),
    );
    document.body.appendChild(backdrop);
  });
}

export function emptyState(icon, title, message, actionEl = null) {
  return h("div", { class: "empty" },
    h("div", { class: "empty__icon" }, icon),
    h("div", { class: "empty__title" }, title),
    message && h("p", null, message),
    actionEl,
  );
}
