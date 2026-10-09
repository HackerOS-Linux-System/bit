import { $, clear, h } from "./dom.js";
import { loadIndex, parseGithub } from "./index-data.js";
import type { LibEntry } from "./types.js";
import { initChrome } from "./chrome.js";
import { onBackOnline } from "./offline.js";
import { loadReleases, type Repo } from "./repodata.js";
import { mountLangBar } from "./langbar.js";
import { mountSource, type SourceBrowser } from "./source.js";
import { mountVersions } from "./versions.js";
import { mountApi } from "./apidoc.js";
import { mountOverview } from "./overview.js";

type Tab = "overview" | "api" | "source" | "versions";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "api", label: "API" },
  { id: "source", label: "Source" },
  { id: "versions", label: "Versions" },
];

function validRef(v: string | null): string | null {
  return v && /^[\w.+#@/-]{1,100}$/.test(v) && !v.includes("..") ? v : null;
}

/** Version picker: shows the version being viewed; the release list is only fetched when it is opened. */
function versionPicker(entry: LibEntry, repo: Repo, refParam: string | null): HTMLElement {
  const current = refParam ?? (entry.rev || "");
  const select = h("select", { class: "ver-select", "aria-label": "Version" }, h("option", { value: current }, current || "default branch"));
  let loaded = false;
  const populate = async (): Promise<void> => {
    if (loaded) return;
    loaded = true;
    try {
      const res = await loadReleases(repo);
      const tags = (res.value ?? []).map((r) => r.tag);
      if (tags.length === 0) return;
      select.replaceChildren(
        h("option", { value: "" }, "default branch"),
        ...tags.map((t) => {
          const o = h("option", { value: t }, t);
          if (t === current) o.selected = true;
          return o;
        }),
      );
      if (!current) (select.options[0] as HTMLOptionElement).selected = true;
      else if (!tags.includes(current)) {
        select.prepend(h("option", { value: current }, current));
        select.value = current;
      }
    } catch {
      loaded = false; // retry on the next open
    }
  };
  select.addEventListener("focus", () => void populate());
  select.addEventListener("pointerdown", () => void populate());
  select.addEventListener("change", () => {
    const u = new URL(location.href);
    if (select.value) u.searchParams.set("ref", select.value);
    else u.searchParams.delete("ref");
    location.href = u.href;
  });
  return h("label", { class: "ver-picker" }, h("span", { class: "muted small" }, "Version "), select);
}

async function main(): Promise<void> {
  initChrome();
  const root = $("detail");
  const params = new URLSearchParams(location.search);
  const name = params.get("name") ?? "";
  if (!name) {
    root.append(h("p", { class: "empty" }, "No library selected. "), h("a", { href: "index.html" }, "Browse the index"));
    return;
  }
  document.title = `${name} — bit.io`;

  let entry: LibEntry | undefined;
  let libs: LibEntry[] = [];
  try {
    libs = (await loadIndex()).libraries;
    entry = libs.find((l) => l.name.toLowerCase() === name.toLowerCase());
  } catch (e) {
    clear(root);
    root.append(
      h(
        "p",
        { class: "empty" },
        navigator.onLine
          ? `Could not load the index (${e instanceof Error ? e.message : "error"}).`
          : "You're offline and the library index hasn't been saved in this browser yet. Open bit.io once while online.",
      ),
    );
    return;
  }
  if (!entry) {
    clear(root);
    root.append(h("p", { class: "empty" }, `"${name}" is not in the index.`), h("a", { href: "index.html" }, "Browse the index"));
    return;
  }
  document.querySelector('meta[name="description"]')?.setAttribute("content", `${entry.name} — ${entry.description || "a library on bit.io"}`);

  const gh = parseGithub(entry.target);
  const refParam = validRef(params.get("ref"));
  const repo: Repo | null = gh ? { owner: gh.owner, repo: gh.repo, ref: refParam ?? (entry.rev || "HEAD") } : null;

  clear(root);
  root.append(
    h("h1", {}, entry.name),
    h("p", { class: "lead" }, entry.description || ""),
    h("div", { class: "tags" }, ...entry.tags.map((t) => h("a", { class: "tag", href: `index.html?tag=${encodeURIComponent(t)}` }, t))),
  );
  if (refParam) {
    root.append(
      h(
        "p",
        { class: "ref-banner" },
        `Viewing version ${refParam}. `,
        h("a", { href: `lib.html?name=${encodeURIComponent(entry.name)}${location.hash}` }, "Back to the default version"),
      ),
    );
  }

  /* tabs */
  const tablist = h("div", { class: "tabs", role: "tablist", "aria-label": "Library sections" });
  const panels = new Map<Tab, HTMLElement>();
  const tabLinks = new Map<Tab, HTMLAnchorElement>();
  for (const t of TABS) {
    const a = h("a", { class: "tab", role: "tab", href: `#${t.id}`, id: `tab-${t.id}`, "aria-controls": `panel-${t.id}` }, t.label);
    tabLinks.set(t.id, a);
    tablist.append(a);
    panels.set(t.id, h("section", { class: "tab-panel", role: "tabpanel", id: `panel-${t.id}`, "aria-labelledby": `tab-${t.id}`, hidden: "" }));
  }
  if (repo) tablist.append(h("span", { class: "grow" }), versionPicker(entry, repo, refParam));
  root.append(tablist, ...panels.values());

  const overview = mountOverview(panels.get("overview") as HTMLElement, { entry, repo, libs });
  onBackOnline(() => overview.reload());

  const sourcePanel = panels.get("source") as HTMLElement;
  const versionsPanel = panels.get("versions") as HTMLElement;
  const apiPanel = panels.get("api") as HTMLElement;
  let source: SourceBrowser | null = null;
  let versions: { load: () => void } | null = null;
  let api: { load: () => void } | null = null;
  if (repo) {
    versions = mountVersions(versionsPanel, entry, repo);
    api = mountApi(apiPanel, repo);
    mountLangBar(repo);
  } else {
    for (const p of [sourcePanel, versionsPanel, apiPanel]) p.append(h("p", { class: "muted" }, "Only available for libraries hosted on GitHub."));
  }

  /* router: #overview | #api | #source[/path[:L12-20]] | #versions */
  const route = (): void => {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash.startsWith("user-content-")) return; // an anchor inside a README: stay on the current tab
    const id = (hash.split("/")[0] ?? "") as Tab;
    const tab: Tab = TABS.some((t) => t.id === id) ? id : "overview";
    for (const t of TABS) {
      const on = t.id === tab;
      (panels.get(t.id) as HTMLElement).hidden = !on;
      const a = tabLinks.get(t.id) as HTMLAnchorElement;
      a.classList.toggle("is-active", on);
      a.setAttribute("aria-selected", String(on));
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    if (tab === "source" && repo) {
      source ??= mountSource(sourcePanel, repo);
      source.show(hash.length > "source/".length ? hash.slice("source/".length) : null);
    }
    if (tab === "versions") versions?.load();
    if (tab === "api") api?.load();
  };
  window.addEventListener("hashchange", route);
  route();
}

void main();
