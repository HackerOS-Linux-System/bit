import { formatAge } from "./store.js";

let bar: HTMLElement | null = null;
const stale = new Map<string, number | null>();
const listeners: Array<() => void> = [];

function ensureBar(): HTMLElement {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "offline-bar";
  bar.className = "offline-bar";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.hidden = true;
  document.body.prepend(bar);
  return bar;
}

function update(): void {
  const el = ensureBar();
  const offline = !navigator.onLine;
  if (!offline && stale.size === 0) {
    el.hidden = true;
    return;
  }
  const ages = [...stale.values()].filter((a): a is number => a !== null);
  const oldest = ages.length ? Math.max(...ages) : null;
  const lead = offline ? "No internet connection" : "Couldn't reach the network";
  el.textContent = `${lead} — showing data saved in this browser${oldest !== null ? ` (${formatAge(oldest)})` : ""}.`;
  el.hidden = false;
}

export function initOffline(): void {
  ensureBar();
  update();
  window.addEventListener("offline", update);
  window.addEventListener("online", () => {
    stale.clear();
    update();
    for (const cb of listeners) cb();
  });
}

/** A piece of data was served from the saved copy because the network failed. */
export function markStale(key: string, ageMs: number | null): void {
  stale.set(key, ageMs);
  update();
}

export function clearStale(key: string): void {
  if (stale.delete(key)) update();
}

/** Called when the browser reports the connection is back (to refresh what was stale). */
export function onBackOnline(cb: () => void): void {
  listeners.push(cb);
}

export function isOffline(): boolean {
  return !navigator.onLine;
}
