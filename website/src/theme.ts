const KEY = "bitio:theme";

function apply(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function initTheme(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* storage can be unavailable (private mode) — fall through */
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  apply(stored === "light" || stored === "dark" ? stored : prefersDark ? "dark" : "light");

  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
    });
  });
}
