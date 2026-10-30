/* App shell: top bar, view container, routing, state wiring, service worker. */

import { h, clear } from "./util/dom.js";
import { state, subscribe, initApp } from "./state.js";
import { parseRoute, navigate } from "./router.js";
import * as dashboard from "./views/dashboard.js";
import * as medForm from "./views/medForm.js";
import * as historyView from "./views/history.js";
import * as settingsView from "./views/settings.js";

const app = document.getElementById("app");
let currentRoute = { name: "dashboard" };
let currentSheet = null;
let lastRenderedRoute = null;

function renderShell() {
  clear(app);
  app.appendChild(h("div", { class: "topbar" },
    h("div", { class: "topbar__row" },
      currentRoute.name !== "dashboard" && h("button", {
        class: "iconbtn", "aria-label": "Back", onclick: () => navigate("#/"),
      }, "‹"),
      h("div", { class: "topbar__title" }, "Med Time Tracker"),
      h("button", {
        class: `iconbtn ${currentRoute.name === "history" ? "iconbtn--active" : ""}`,
        "aria-label": "Dose history", onclick: () => navigate("#/history"),
      }, "📋"),
      h("button", {
        class: `iconbtn ${currentRoute.name === "settings" ? "iconbtn--active" : ""}`,
        "aria-label": "Settings", onclick: () => navigate("#/settings"),
      }, "⚙️"),
    ),
  ));
  const view = h("div", { class: "content", id: "view" });
  app.appendChild(view);
  return view;
}

function renderRoute() {
  // close any open medication sheet when the route moves away from it
  if (currentSheet && !(lastRenderedRoute === "med" && currentRoute.name === "med")) {
    currentSheet.close();
    currentSheet = null;
  }

  const view = renderShell();

  if (!state.ready) {
    // boot splash equivalent, while the store initializes
    view.appendChild(h("div", { class: "boot-splash" },
      h("div", { class: "boot-splash__logo" }, "⏱️"),
      h("div", { class: "boot-splash__text" }, "Loading…"),
    ));
    lastRenderedRoute = currentRoute.name;
    return;
  }

  switch (currentRoute.name) {
    case "history":
      dashboard.destroy();
      historyView.render(view);
      break;
    case "settings":
      dashboard.destroy();
      settingsView.render(view);
      break;
    case "med": {
      dashboard.render(view);
      // keep the existing sheet across data-change re-renders (preserves the draft)
      if (!(lastRenderedRoute === "med" && currentSheet)) {
        currentSheet = medForm.render(view, { id: currentRoute.id });
      }
      break;
    }
    default:
      dashboard.render(view);
  }
  lastRenderedRoute = currentRoute.name;
}

function onHashChange() {
  currentRoute = parseRoute(location.hash);
  renderRoute();
}

async function boot() {
  addEventListener("hashchange", onHashChange);
  subscribe(renderRoute);
  currentRoute = parseRoute(location.hash);
  renderRoute();

  try {
    await initApp();
  } catch (e) {
    console.error("boot failed", e);
  }
  renderRoute();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
  }
}

boot();
