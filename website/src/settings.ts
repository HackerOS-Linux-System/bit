import { $, h } from "./dom.js";
import { initChrome } from "./chrome.js";
import { fetchRateLimit, getGithubToken, hasGithubToken, rateLimitNote, setGithubToken } from "./github.js";
import { cacheClear, cacheStats, formatBytes } from "./store.js";

const TOKEN_SHAPE = /^(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}$|^[a-f0-9]{40}$/;

function setStatus(el: HTMLElement, text: string, kind: "ok" | "warn" | "err" | ""): void {
  el.textContent = text;
  el.className = `status${kind ? ` is-${kind}` : ""}`;
}

function initToken(): void {
  const input = $<HTMLInputElement>("token-input");
  const show = $<HTMLInputElement>("token-show");
  const status = $("token-status");
  const rate = $("token-rate");
  const saveBtn = $<HTMLButtonElement>("token-save");
  const clearBtn = $<HTMLButtonElement>("token-clear");
  const testBtn = $<HTMLButtonElement>("token-test");

  input.value = getGithubToken();
  show.addEventListener("change", () => (input.type = show.checked ? "text" : "password"));

  const refreshState = (): void => {
    document.querySelectorAll("[data-settings-link]").forEach((a) => a.classList.toggle("has-token", hasGithubToken()));
    setStatus(
      status,
      hasGithubToken() ? "A token is saved in this browser." : "No token saved — GitHub's anonymous limit (60 requests/hour per IP) applies.",
      hasGithubToken() ? "ok" : "",
    );
  };

  const test = async (): Promise<void> => {
    rate.textContent = "Checking…";
    testBtn.disabled = true;
    try {
      const r = await fetchRateLimit();
      if (!r.ok) {
        rate.textContent = r.status === 401 ? "GitHub rejected this token (401). Check that it is correct and not expired." : `GitHub API → HTTP ${r.status}.`;
        rate.className = "status is-err";
      } else if (r.rate) {
        const note = rateLimitNote();
        rate.textContent = `${r.rate.remaining} of ${r.rate.limit ?? "?"} requests left this hour${note ? ` — ${note}` : ""}${hasGithubToken() ? " (authenticated)" : " (anonymous)"}.`;
        rate.className = "status is-ok";
      } else {
        rate.textContent = "Connected, but GitHub didn't report a limit.";
        rate.className = "status";
      }
    } catch {
      rate.textContent = "Couldn't reach GitHub — are you offline?";
      rate.className = "status is-warn";
    } finally {
      testBtn.disabled = false;
    }
  };

  saveBtn.addEventListener("click", () => {
    const v = input.value.trim();
    if (!v) return clearBtn.click();
    if (!setGithubToken(v)) {
      setStatus(status, "Couldn't save: this browser blocks localStorage.", "err");
      return;
    }
    refreshState();
    if (!TOKEN_SHAPE.test(v)) setStatus(status, "Saved, but it doesn't look like a GitHub token (ghp_…, github_pat_…). Use “Test token” to check.", "warn");
    void test();
  });
  clearBtn.addEventListener("click", () => {
    setGithubToken("");
    input.value = "";
    refreshState();
    rate.textContent = "";
  });
  testBtn.addEventListener("click", () => void test());
  refreshState();
  if (hasGithubToken() && navigator.onLine) void test();
}

function initOfflineData(): void {
  const out = $("cache-stats");
  const render = (): void => {
    const s = cacheStats();
    out.replaceChildren(
      document.createTextNode(
        s.entries === 0
          ? "Nothing saved yet. Open the index and a few libraries while online and they will work offline."
          : `${s.entries} saved item${s.entries === 1 ? "" : "s"} (${formatBytes(s.bytes)}) · ${s.libraries} librar${s.libraries === 1 ? "y" : "ies"} readable offline.`,
      ),
    );
  };
  render();
  const btn = $<HTMLButtonElement>("cache-clear");
  btn.addEventListener("click", () => {
    cacheClear();
    render();
    btn.textContent = "Cleared ✓";
    setTimeout(() => (btn.textContent = "Clear saved data"), 1400);
  });
  const sw = $("sw-status");
  if (!("serviceWorker" in navigator)) sw.textContent = "Not supported by this browser — the data above still works, but the page itself needs a connection.";
  else
    void navigator.serviceWorker.getRegistration().then((reg) => {
      sw.replaceChildren(h("span", {}, reg?.active ? "Offline mode is active: the site itself opens without a connection." : "Offline mode will turn on after the next page load."));
    });
}

initChrome();
initToken();
initOfflineData();
