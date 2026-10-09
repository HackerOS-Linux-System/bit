import { clear, copyButton, h, safeUrl } from "./dom.js";
import { renderMarkdown } from "./markdown.js";
import { decorateCode } from "./codeblocks.js";
import { diffLines, manifestChanges } from "./diff.js";
import { loadManifest, loadReleases, type Release, type Repo } from "./repodata.js";
import { GithubError } from "./github.js";
import { formatAge, formatBytes } from "./store.js";
import type { LibEntry } from "./types.js";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function row(entry: LibEntry, repo: Repo, r: Release, latest: boolean, prev: Release | undefined): HTMLElement {
  const pinned = !!entry.rev && entry.rev === r.tag;
  const viewing = repo.ref === r.tag;
  const title = r.name && r.name !== r.tag ? `${r.name}` : "";

  const badges: HTMLElement[] = [];
  if (latest) badges.push(h("span", { class: "vbadge is-latest" }, "Latest"));
  if (r.prerelease) badges.push(h("span", { class: "vbadge is-pre" }, "Pre-release"));
  if (r.draft) badges.push(h("span", { class: "vbadge is-pre" }, "Draft"));
  if (pinned) badges.push(h("span", { class: "vbadge is-pin", title: "The index pins this version" }, "Pinned in index"));
  if (viewing) badges.push(h("span", { class: "vbadge" }, "Viewing"));

  const bitHk = `-> ${entry.name} => rev ${r.tag}`;
  const actions = h(
    "div",
    { class: "ver-actions" },
    h("a", { class: "copy", href: `lib.html?name=${encodeURIComponent(entry.name)}&ref=${encodeURIComponent(r.tag)}#source` }, "Browse source"),
    h("a", { class: "copy", href: safeUrl(r.url), target: "_blank", rel: "noopener" }, "GitHub ↗"),
    prev
      ? h("a", { class: "copy", href: `https://github.com/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(prev.tag)}...${encodeURIComponent(r.tag)}`, target: "_blank", rel: "noopener" }, `Compare with ${prev.tag} ↗`)
      : null,
    copyButton(bitHk, "Copy Bit.hk line"),
  );

  const el = h(
    "li",
    { class: "ver" },
    h(
      "div",
      { class: "ver-head" },
      h("h3", {}, h("a", { href: safeUrl(r.url), target: "_blank", rel: "noopener" }, r.tag)),
      ...badges,
      h("span", { class: "muted small ver-date" }, [title, r.date ? fmtDate(r.date) : ""].filter(Boolean).join(" · ")),
    ),
    actions,
  );

  if (r.body.trim()) {
    const d = h("details", { class: "ver-notes" }, h("summary", {}, "Release notes"));
    const md = h("div", { class: "markdown-body" });
    let drawn = false;
    d.addEventListener("toggle", () => {
      if (!d.open || drawn) return;
      drawn = true;
      md.append(renderMarkdown(r.body, { owner: repo.owner, repo: repo.repo, ref: r.tag }));
      decorateCode(md);
    });
    d.append(md);
    el.append(d);
  }

  if (prev) el.append(manifestDiff(repo, prev, r));

  if (r.assets.length > 0) {
    el.append(
      h(
        "ul",
        { class: "ver-assets" },
        ...r.assets.map((a) =>
          h(
            "li",
            {},
            a.url ? h("a", { href: safeUrl(a.url), rel: "noopener" }, a.name) : a.name,
            h("span", { class: "muted small" }, `  ${formatBytes(a.size)} · ${a.downloads.toLocaleString()} download${a.downloads === 1 ? "" : "s"}`),
          ),
        ),
      ),
    );
  }
  return el;
}

/** What changed in Bit.hk between two releases (both files come from raw.githubusercontent.com — no API quota). */
function manifestDiff(repo: Repo, prev: Release, cur: Release): HTMLElement {
  const d = h("details", { class: "ver-notes ver-diff" }, h("summary", {}, `Manifest changes since ${prev.tag}`));
  const body = h("div", {});
  d.append(body);
  let loaded = false;
  d.addEventListener("toggle", () => {
    if (!d.open || loaded) return;
    loaded = true;
    body.replaceChildren(h("p", { class: "muted small" }, "Reading both manifests…"));
    void (async () => {
      try {
        const [a, b] = await Promise.all([loadManifest({ ...repo, ref: prev.tag }), loadManifest({ ...repo, ref: cur.tag })]);
        if (!a.value || !b.value) {
          body.replaceChildren(h("p", { class: "muted small" }, "No Bit.hk in one of these versions."));
          return;
        }
        const summary = manifestChanges(a.value.doc, b.value.doc);
        const lines = diffLines(a.value.text.split("\n"), b.value.text.split("\n"));
        const pre = h("pre", { class: "diff" });
        if (!lines || lines.every((l) => l.t === " ")) pre.append(document.createTextNode(lines ? "No changes to Bit.hk." : "Bit.hk is too large to diff here."));
        else {
          for (const l of lines) {
            pre.append(h("span", { class: `diff-${l.t === "+" ? "add" : l.t === "-" ? "del" : l.t === "…" ? "gap" : "ctx"}` }, l.t === "…" ? "  …" : `${l.t} ${l.s}`));
          }
        }
        body.replaceChildren(...(summary.length ? [h("ul", { class: "deps" }, ...summary.map((x) => h("li", {}, x)))] : []), pre);
      } catch {
        body.replaceChildren(h("p", { class: "muted small" }, "Couldn't read the manifests (offline?)."));
      }
    })();
  });
  return d;
}

export function mountVersions(panel: HTMLElement, entry: LibEntry, repo: Repo): { load: () => void } {
  const box = h("div", {}, h("p", { class: "muted" }, "Loading versions…"));
  panel.append(box);
  let started = false;

  const run = async (): Promise<void> => {
    started = true;
    box.replaceChildren(h("p", { class: "muted" }, "Loading versions…"));
    try {
      const res = await loadReleases(repo);
      const list = res.value ?? [];
      clear(box);
      if (list.length === 0) {
        box.append(
          h("p", { class: "empty-note" }, "This repository has no releases or tags yet. The index installs it from the default branch."),
          h("a", { href: `https://github.com/${repo.owner}/${repo.repo}/releases`, target: "_blank", rel: "noopener" }, "Open releases on GitHub ↗"),
        );
        return;
      }
      const tagOnly = list.every((r) => r.tagOnly);
      const firstStable = list.findIndex((r) => !r.prerelease && !r.draft);
      box.append(
        h(
          "p",
          { class: "muted small" },
          `${list.length} ${tagOnly ? "tag" : "release"}${list.length === 1 ? "" : "s"}${tagOnly ? " (no GitHub releases published — showing tags)" : ""}${res.stale ? ` · saved copy (${formatAge(res.ageMs)})` : ""}`,
        ),
        h("ol", { class: "versions" }, ...list.map((r, i) => row(entry, repo, r, i === (firstStable === -1 ? 0 : firstStable), list[i + 1]))),
      );
      if (list.length >= 50) {
        box.append(h("p", { class: "muted small" }, "Showing the 50 most recent. ", h("a", { href: `https://github.com/${repo.owner}/${repo.repo}/releases`, target: "_blank", rel: "noopener" }, "All releases on GitHub ↗")));
      }
    } catch (e) {
      const limited = e instanceof GithubError;
      const retry = h("button", { class: "retry-btn", type: "button" }, "Try again");
      retry.addEventListener("click", () => void run());
      box.replaceChildren(
        h("p", { class: "muted" }, limited ? e.message : "Couldn't load releases. If you're offline, open this tab once while online to save it."),
        h("div", { class: "lang-actions" }, retry, limited ? h("a", { class: "retry-btn", href: "settings.html" }, "Add token") : null),
      );
    }
  };

  return {
    load: () => {
      if (!started) void run();
    },
  };
}
