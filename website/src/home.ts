import { $, clear, copyButton, h, safeUrl } from "./dom.js";
import { loadIndex, type Index } from "./index-data.js";
import { LANGS, langInfo } from "./langs.js";
import type { Lang, LibEntry } from "./types.js";
import { initTheme } from "./theme.js";

interface State {
  q: string;
  lang: Lang | "all";
  tag: string;
}

const state: State = { q: "", lang: "all", tag: "" };
let all: LibEntry[] = [];

function readUrl(): void {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") ?? "";
  const l = p.get("lang");
  state.lang = l === "hsharp" || l === "hackerlang" || l === "hackerscript" || l === "any" ? l : "all";
  state.tag = p.get("tag") ?? "";
}

function writeUrl(): void {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.lang !== "all") p.set("lang", state.lang);
  if (state.tag) p.set("tag", state.tag);
  const s = p.toString();
  history.replaceState(null, "", s ? `?${s}` : location.pathname);
}

function matches(e: LibEntry): boolean {
  if (state.lang !== "all" && e.lang !== state.lang) return false;
  if (state.tag && !e.tags.some((t) => t.toLowerCase() === state.tag.toLowerCase())) return false;
  if (!state.q) return true;
  const n = state.q.toLowerCase();
  return (
    e.name.toLowerCase().includes(n) ||
    e.description.toLowerCase().includes(n) ||
    e.author.toLowerCase().includes(n) ||
    e.tags.some((t) => t.toLowerCase().includes(n))
  );
}

function langBadge(l: Lang): HTMLElement {
  const info = langInfo(l);
  const b = h("span", { class: "badge" }, info.label);
  b.style.setProperty("--badge", info.color);
  return b;
}

function card(e: LibEntry): HTMLElement {
  const install = `bit install ${e.name}`;
  return h(
    "article",
    { class: "card" },
    h(
      "header",
      { class: "card-head" },
      h("h3", {}, h("a", { href: `lib.html?name=${encodeURIComponent(e.name)}` }, e.name)),
      langBadge(e.lang),
    ),
    h("p", { class: "card-desc" }, e.description || "No description."),
    h(
      "div",
      { class: "tags" },
      ...e.tags.slice(0, 5).map((t) => {
        const b = h("button", { class: "tag", type: "button" }, t);
        b.addEventListener("click", () => {
          state.tag = t;
          render();
        });
        return b;
      }),
    ),
    h(
      "footer",
      { class: "card-foot" },
      h("code", {}, install),
      copyButton(install),
      e.target ? h("a", { class: "ext", href: safeUrl(e.target), rel: "noopener", target: "_blank" }, "source ↗") : null,
    ),
  );
}

function renderFilters(): void {
  const bar = $("lang-filters");
  clear(bar);
  const mk = (id: Lang | "all", label: string, color?: string): HTMLElement => {
    const b = h("button", { class: `chip${state.lang === id ? " on" : ""}`, type: "button" }, label);
    if (color) b.style.setProperty("--badge", color);
    b.addEventListener("click", () => {
      state.lang = id;
      render();
    });
    return b;
  };
  bar.append(mk("all", "All languages"));
  for (const l of LANGS) bar.append(mk(l.id, l.label, l.color));
}

function renderTags(): void {
  const wrap = $("tag-filter");
  clear(wrap);
  if (!state.tag) return;
  const b = h("button", { class: "chip on", type: "button" }, `tag: ${state.tag} ✕`);
  b.addEventListener("click", () => {
    state.tag = "";
    render();
  });
  wrap.append(b);
}

function render(): void {
  writeUrl();
  renderFilters();
  renderTags();
  const grid = $("grid");
  clear(grid);
  const list = all.filter(matches);
  $("count").textContent = `${list.length} of ${all.length} libraries`;
  if (list.length === 0) {
    grid.append(h("p", { class: "empty" }, "Nothing matches. Try another search or clear the filters."));
    return;
  }
  for (const e of list) grid.append(card(e));
}

function stats(ix: Index): void {
  $("stat-libs").textContent = String(ix.libraries.length);
  const langs = new Set(ix.libraries.map((l) => l.lang).filter((l) => l !== "any"));
  $("stat-langs").textContent = String(Math.max(langs.size, 3));
  $("stat-updated").textContent = ix.updatedAt || "—";
}

async function main(): Promise<void> {
  initTheme();
  readUrl();
  const search = $<HTMLInputElement>("search");
  search.value = state.q;
  search.addEventListener("input", () => {
    state.q = search.value.trim();
    render();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "/" && document.activeElement !== search) {
      ev.preventDefault();
      search.focus();
    }
  });
  $("hero-install").append(copyButton("bit install <name>"));

  try {
    const ix = await loadIndex();
    all = ix.libraries;
    stats(ix);
    render();
  } catch (e) {
    clear($("grid"));
    $("grid").append(
      h("p", { class: "empty" }, `Could not load the library index (${e instanceof Error ? e.message : "unknown error"}).`),
    );
  }
}

void main();
