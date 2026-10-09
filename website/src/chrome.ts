import { initTheme } from "./theme.js";
import { initOffline } from "./offline.js";
import { hasGithubToken } from "./github.js";

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline shell just won't be available (e.g. file:// or blocked) */
    });
  });
}

export function initChrome(): void {
  initTheme();
  initOffline();
  registerServiceWorker();
  if (hasGithubToken()) document.querySelectorAll("[data-settings-link]").forEach((a) => a.classList.add("has-token"));
}
