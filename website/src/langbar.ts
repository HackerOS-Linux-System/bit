import { h } from "./dom.js";
import { breakdownFromTree, colorForLanguage, needsOutline, type LangShare } from "./langcolors.js";
import { loadTree, type Repo } from "./repodata.js";
import { GithubError } from "./github.js";
import { formatAge } from "./store.js";

const COLLAPSED_KEY = "bitio:langbar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function mountLangBar(repo: Repo): void {
  const body = h("div", { class: "lang-widget-body" }, h("p", { class: "muted small" }, "Detecting languages…"));
  const toggle = h("button", { class: "lang-widget-toggle", type: "button", "aria-label": "Collapse language bar", "aria-expanded": "true" }, "–");
  const title = h("h4", {}, "Languages");
  const widget = h("aside", { class: "lang-widget", "aria-label": "Languages used in this library" }, h("div", { class: "lang-widget-head" }, title, toggle), body);
  document.body.append(widget);

  const apply = (collapsed: boolean): void => {
    widget.classList.toggle("is-collapsed", collapsed);
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "+" : "–";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expand language bar" : "Collapse language bar");
  };
  apply(readCollapsed());
  toggle.addEventListener("click", () => {
    const next = !widget.classList.contains("is-collapsed");
    apply(next);
    writeCollapsed(next);
  });

  const run = async (): Promise<void> => {
    body.replaceChildren(h("p", { class: "muted small" }, "Detecting languages…"));
    try {
      const res = await loadTree(repo);
      const shares = res.value ? breakdownFromTree(res.value.files.map((f) => ({ path: f.path, type: "blob", size: f.size }))) : [];
      if (shares.length === 0) {
        body.replaceChildren(h("p", { class: "muted small" }, res.value ? "No known source languages found." : "Couldn't read this repository's files."));
        return;
      }
      render(body, shares, res.stale ? res.ageMs : null);
    } catch (e) {
      const limited = e instanceof GithubError;
      const retry = h("button", { class: "retry-btn", type: "button" }, "Try again");
      retry.addEventListener("click", () => void run());
      body.replaceChildren(
        h("p", { class: "muted small" }, limited ? e.message : "Couldn't detect languages (offline?)."),
        h(
          "div",
          { class: "lang-actions" },
          retry,
          limited ? h("a", { class: "retry-btn", href: "settings.html" }, "Add token") : null,
        ),
      );
    }
  };
  void run();
  window.addEventListener("online", () => void run());
}

function render(body: HTMLElement, shares: LangShare[], staleAge: number | null): void {
  const top = shares[0];
  const bar = h("div", { class: "lang-bar", role: "img", "aria-label": shares.map((s) => `${s.name} ${s.pct.toFixed(1)}%`).join(", ") });
  const legend = h("div", { class: "lang-legend" });
  for (const s of shares) {
    const seg = h("span", { class: needsOutline(s.name) ? "is-light" : "" });
    seg.style.flexBasis = `${s.pct}%`;
    seg.style.background = colorForLanguage(s.name);
    seg.title = `${s.name} ${s.pct.toFixed(1)}%`;
    bar.append(seg);

    const dot = h("span", { class: `dot${needsOutline(s.name) ? " is-light" : ""}` });
    dot.style.background = colorForLanguage(s.name);
    legend.append(h("div", { class: "lang-legend-item" }, dot, h("b", {}, s.name), h("span", { class: "pct" }, `${s.pct < 0.1 ? "<0.1" : s.pct.toFixed(1)}%`)));
  }

  const nodes: Array<HTMLElement | null> = [];
  if (top && top.name === "H#") {
    nodes.push(
      h(
        "div",
        { class: "hsharp-badge" },
        h("div", { class: "hsharp-hex" }, h("span", { class: "hsharp-hex-label" }, "H#")),
        h("div", { class: "hsharp-badge-text" }, h("div", { class: "top" }, "H# leads this library"), h("div", { class: "sub" }, `${top.pct.toFixed(1)}% of tracked bytes`)),
      ),
    );
  }
  nodes.push(bar, legend);
  if (staleAge !== null) nodes.push(h("p", { class: "muted small" }, `Saved copy · ${formatAge(staleAge)}`));
  body.replaceChildren(...(nodes.filter(Boolean) as HTMLElement[]));
}
