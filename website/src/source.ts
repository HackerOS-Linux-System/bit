import { clear, copyButton, h } from "./dom.js";
import { highlight, toLines } from "./highlight.js";
import { extensionOf } from "./langcolors.js";
import { renderMarkdown } from "./markdown.js";
import { decorateCode } from "./codeblocks.js";
import { loadDir, loadFile, loadTree, pool, readFileLight, type FileEntry, type Repo } from "./repodata.js";
import { GithubError } from "./github.js";
import { formatAge, formatBytes } from "./store.js";

const MAX_PREVIEW_BYTES = 250_000;
const MAX_LINES = 6000;
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"]);
const BINARY_EXT = new Set([
  "pdf", "zip", "gz", "tgz", "tar", "7z", "rar", "bz2", "xz", "woff", "woff2", "ttf", "eot", "otf", "mp3", "mp4", "mov", "wav", "ogg",
  "webm", "avi", "exe", "dll", "so", "dylib", "a", "o", "class", "jar", "wasm", "bin", "dat", "pyc", "hlib", "bit",
]);

interface Node {
  name: string;
  path: string;
  file?: FileEntry;
  children: Map<string, Node>;
}

function buildTree(files: FileEntry[], extraDirs: Iterable<string> = []): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const d of extraDirs) {
    let node = root;
    let acc = "";
    for (const part of d.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      let next = node.children.get(part);
      if (!next) {
        next = { name: part, path: acc, children: new Map() };
        node.children.set(part, next);
      }
      node = next;
    }
  }
  for (const f of files) {
    let node = root;
    let acc = "";
    const parts = f.path.split("/");
    parts.forEach((part, idx) => {
      acc = acc ? `${acc}/${part}` : part;
      let next = node.children.get(part);
      if (!next) {
        next = { name: part, path: acc, children: new Map() };
        if (idx === parts.length - 1) next.file = f;
        node.children.set(part, next);
      }
      node = next;
    });
  }
  return root;
}

export interface LineRange {
  from: number;
  to: number;
}

/** `src/main.h#:L12-20` → { path, lines } */
export function parseSourceSpec(spec: string): { path: string; lines: LineRange | null } {
  const m = spec.match(/^(.*):L(\d+)(?:-(\d+))?$/);
  if (!m || m[1] === undefined || m[2] === undefined) return { path: spec, lines: null };
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  return { path: m[1], lines: { from: Math.min(from, to), to: Math.max(from, to) } };
}

/** `#source/<path>` with every segment percent-encoded (paths may contain # % ?). */
export function sourceHash(path: string, lines?: string): string {
  return `#source/${path.split("/").map(encodeURIComponent).join("/")}${lines ?? ""}`;
}

export interface SourceBrowser {
  show(spec: string | null): void;
}

export function mountSource(panel: HTMLElement, repo: Repo): SourceBrowser {
  const treeBox = h("div", { class: "src-tree", role: "tree", "aria-label": "Files" }, h("p", { class: "muted small" }, "Loading file tree…"));
  const filter = h("input", { class: "src-filter", type: "search", placeholder: "Filter files…", "aria-label": "Filter files", autocomplete: "off" });
  const status = h("div", { class: "src-status muted small" });
  const searchInput = h("input", { class: "src-filter", type: "search", placeholder: "Search in code…", "aria-label": "Search in code", autocomplete: "off", minlength: "2" });
  const searchForm = h("form", { class: "src-search", role: "search" }, searchInput);
  const view = h("div", { class: "src-view" }, h("p", { class: "src-placeholder" }, "Select a file to read it."));
  panel.append(
    h(
      "div",
      { class: "src-layout" },
      h("aside", { class: "src-side" }, filter, searchForm, status, treeBox),
      view,
    ),
  );

  let files: FileEntry[] = [];
  let truncated = false;
  const extraDirs = new Set<string>();
  let searchToken = 0;
  let ready: Promise<void> | null = null;
  let current = "";
  let pending: string | null = null;

  const ghBase = `https://github.com/${repo.owner}/${repo.repo}`;
  const ghRef = repo.ref.split("/").map(encodeURIComponent).join("/");

  let renderLevel: (node: Node) => HTMLElement = () => h("ul", {});

  function renderTree(): void {
    const root = buildTree(files, extraDirs);
    const total = files.length;
    const level = (node: Node, depth: number): HTMLElement => {
      const ul = h("ul", { class: "src-list", role: depth === 0 ? "none" : "group" });
      const kids = [...node.children.values()].sort((a, b) => {
        const ad = a.file ? 1 : 0;
        const bd = b.file ? 1 : 0;
        return ad - bd || a.name.localeCompare(b.name);
      });
      for (const k of kids) {
        if (k.file) {
          const a = h("a", { class: "src-node is-file", href: sourceHash(k.path), "data-path": k.path, role: "treeitem" }, h("span", { class: "src-icon", "aria-hidden": "true" }, fileIcon(k.name)), h("span", { class: "src-name" }, k.name));
          ul.append(h("li", {}, a));
        } else {
          const d = h("details", {}, h("summary", { class: "src-node is-dir", "data-dir": k.path }, h("span", { class: "src-icon", "aria-hidden": "true" }, "▸"), h("span", { class: "src-name" }, k.name)), level(k, depth + 1));
          if (depth === 0 && total <= 80) d.open = true;
          if (truncated) d.addEventListener("toggle", () => void completeDir(d, k.path), { once: true });
          ul.append(h("li", {}, d));
        }
      }
      return ul;
    };
    renderLevel = (node) => level(node, 1);
    clear(treeBox);
    treeBox.append(level(root, 0));
  }

  /** The recursive listing was cut off: read the folders the visitor actually opens (contents API). */
  async function completeDir(d: HTMLDetailsElement, dir: string): Promise<void> {
    if (!d.open) {
      d.addEventListener("toggle", () => void completeDir(d, dir), { once: true });
      return;
    }
    try {
      const extra = await loadDir(repo, dir);
      if (!extra) return;
      const known = new Set(files.map((f) => f.path));
      const fresh = extra.files.filter((f) => !known.has(f.path));
      const before = extraDirs.size;
      extra.dirs.forEach((x) => extraDirs.add(x));
      if (fresh.length === 0 && extraDirs.size === before) return;
      files = [...files, ...fresh];
      const ul = d.querySelector(":scope > ul");
      const node = findNode(buildTree(files, extraDirs), dir);
      if (ul && node) {
        const rebuilt = renderLevel(node);
        ul.replaceWith(rebuilt);
      }
    } catch {
      /* the partial listing stays usable */
    }
  }

  function openParents(path: string): void {
    const parts = path.split("/");
    parts.pop();
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      const sum = [...treeBox.querySelectorAll<HTMLElement>("summary[data-dir]")].find((s) => s.dataset["dir"] === acc);
      const det = sum?.parentElement;
      if (det instanceof HTMLDetailsElement) det.open = true;
    }
  }

  function markActive(path: string): void {
    treeBox.querySelectorAll(".src-node.is-file.is-active").forEach((n) => {
      n.classList.remove("is-active");
      n.removeAttribute("aria-current");
    });
    const a = [...treeBox.querySelectorAll<HTMLAnchorElement>(".src-node.is-file")].find((n) => n.dataset["path"] === path);
    if (a) {
      a.classList.add("is-active");
      a.setAttribute("aria-current", "true");
      a.scrollIntoView({ block: "nearest" });
    }
  }

  let filterTimer: number | undefined;
  filter.addEventListener("input", () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => applyFilter(filter.value.trim().toLowerCase()), 120);
  });

  function applyFilter(q: string): void {
    const items = treeBox.querySelectorAll<HTMLElement>("li");
    if (!q) {
      items.forEach((li) => (li.hidden = false));
      return;
    }
    items.forEach((li) => (li.hidden = true));
    treeBox.querySelectorAll<HTMLElement>(".src-node.is-file").forEach((a) => {
      if (!(a.dataset["path"] ?? "").toLowerCase().includes(q)) return;
      let li = a.closest("li");
      while (li) {
        li.hidden = false;
        const det = li.parentElement?.closest("details");
        if (det) det.open = true;
        li = det ? det.closest("li") : null;
      }
    });
  }

  async function ensureTree(): Promise<void> {
    if (ready) return ready;
    ready = (async () => {
      try {
        const res = await loadTree(repo);
        if (!res.value || res.value.files.length === 0) {
          treeBox.replaceChildren(h("p", { class: "muted small" }, res.value ? "This repository has no files." : `Nothing found at "${repo.ref}".`));
          return;
        }
        files = res.value.files;
        truncated = res.value.truncated;
        if (truncated) {
          // folders missing from the cut-off listing still show up (and fill in when opened)
          try {
            const top = await loadDir(repo, "");
            top?.dirs.forEach((x) => extraDirs.add(x));
            if (top) {
              const known = new Set(files.map((f) => f.path));
              files = [...files, ...top.files.filter((f) => !known.has(f.path))];
            }
          } catch {
            /* the partial listing is still usable */
          }
        }
        status.textContent = `${files.length} files · ${repo.ref === "HEAD" ? "default branch" : repo.ref}${res.stale ? ` · saved copy (${formatAge(res.ageMs)})` : ""}`;
        renderTree();
        if (res.value.truncated) {
          treeBox.append(h("p", { class: "muted small" }, "Large repository — partial listing. ", h("a", { href: `${ghBase}/tree/${ghRef}`, target: "_blank", rel: "noopener" }, "Open on GitHub ↗")));
        }
      } catch (e) {
        const retry = h("button", { class: "retry-btn", type: "button" }, "Try again");
        retry.addEventListener("click", () => {
          ready = null;
          treeBox.replaceChildren(h("p", { class: "muted small" }, "Loading file tree…"));
          void ensureTree().then(() => pending !== null && show(pending));
        });
        const limited = e instanceof GithubError;
        treeBox.replaceChildren(
          h("p", { class: "muted small" }, limited ? e.message : "Couldn't load the file tree. If you're offline, open this library once while online to save it."),
          h("div", { class: "lang-actions" }, retry, limited ? h("a", { class: "retry-btn", href: "settings.html" }, "Add token") : null),
        );
        ready = null;
      }
    })();
    return ready;
  }

  function head(path: string, extra: Array<HTMLElement | null>): HTMLElement {
    const crumbs: Array<string | HTMLElement> = [];
    path.split("/").forEach((p, i, all) => {
      if (i > 0) crumbs.push(" / ");
      crumbs.push(h("span", { class: i === all.length - 1 ? "src-crumb is-last" : "src-crumb" }, p));
    });
    const rawUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${ghRef}/${path.split("/").map(encodeURIComponent).join("/")}`;
    return h(
      "div",
      { class: "src-view-head" },
      h("div", { class: "src-breadcrumb" }, ...crumbs),
      h(
        "div",
        { class: "src-view-actions" },
        ...extra,
        h("a", { class: "copy", href: rawUrl, target: "_blank", rel: "noopener" }, "Raw"),
        h("a", { class: "copy", href: `${ghBase}/blob/${ghRef}/${path.split("/").map(encodeURIComponent).join("/")}`, target: "_blank", rel: "noopener" }, "GitHub ↗"),
      ),
    );
  }

  function message(path: string, text: string): void {
    view.replaceChildren(head(path, []), h("div", { class: "src-unavailable" }, h("p", {}, text)));
  }

  function highlightLines(range: LineRange | null, scroll: boolean): void {
    view.querySelectorAll(".src-line.is-hl").forEach((l) => l.classList.remove("is-hl"));
    if (!range) return;
    let first: Element | null = null;
    for (let n = range.from; n <= range.to; n++) {
      const l = view.querySelector(`.src-line[data-n="${n}"]`);
      if (!l) continue;
      l.classList.add("is-hl");
      first ??= l;
    }
    if (scroll) first?.scrollIntoView({ block: "center" });
  }

  function codeView(text: string, path: string, ext: string, range: LineRange | null): HTMLElement {
    const name = path.split("/").pop() ?? path;
    let lines = toLines(highlight(text.replace(/\r\n?/g, "\n"), ext, name));
    if (lines.length > 1 && (lines[lines.length - 1]?.length ?? 0) === 0) lines.pop();
    const total = lines.length;
    const cut = total > MAX_LINES;
    if (cut) lines = lines.slice(0, MAX_LINES);

    const code = h("code", {});
    lines.forEach((tokens, idx) => {
      const n = idx + 1;
      const ln = h("a", { class: "ln", href: sourceHash(path, `:L${n}`), "data-n": String(n), "aria-label": `Line ${n}` });
      const lc = h("span", { class: "lc" });
      for (const t of tokens) lc.append(t.kind ? h("span", { class: `tok-${t.kind}` }, t.text) : document.createTextNode(t.text));
      if (tokens.length === 0) lc.append(document.createTextNode("​"));
      code.append(h("div", { class: "src-line", "data-n": String(n) }, ln, lc));
    });
    const wrap = h("div", { class: "src-code-wrap" }, h("pre", { class: "src-code" }, code));
    if (cut) wrap.append(h("p", { class: "src-truncated-note" }, `Showing the first ${MAX_LINES.toLocaleString()} of ${total.toLocaleString()} lines. `, h("a", { href: `${ghBase}/blob/${ghRef}/${path}`, target: "_blank", rel: "noopener" }, "Open the full file on GitHub ↗")));
    void range;
    return wrap;
  }

  async function openFile(path: string, range: LineRange | null): Promise<void> {
    searchToken++;
    if (path === current) {
      highlightLines(range, true);
      return;
    }
    current = path;
    markActive(path);
    openParents(path);
    const entry = files.find((f) => f.path === path);
    const ext = extensionOf(path);

    if (!entry) {
      message(path, `"${path}" is not in this version of the repository.`);
      return;
    }
    if (IMAGE_EXT.has(ext)) {
      const src = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${ghRef}/${path.split("/").map(encodeURIComponent).join("/")}`;
      view.replaceChildren(head(path, []), h("div", { class: "src-image" }, h("img", { src, alt: path, loading: "lazy", referrerpolicy: "no-referrer" })));
      return;
    }
    if (BINARY_EXT.has(ext) || entry.size > MAX_PREVIEW_BYTES) {
      message(path, entry.size > MAX_PREVIEW_BYTES ? `${formatBytes(entry.size)} — too large to preview here. Use Raw or GitHub above.` : "Binary file — nothing to preview. Use Raw or GitHub above.");
      return;
    }

    view.replaceChildren(head(path, []), h("p", { class: "muted small src-loading" }, "Loading…"));
    try {
      const res = await loadFile(repo, path);
      if (current !== path) return; // the visitor already clicked something else
      if (res.value === null) {
        message(path, "This file could not be found on GitHub.");
        return;
      }
      const text = res.value;
      const isMd = /^(md|markdown)$/.test(ext);
      const body = h("div", { class: "src-body" });
      const copy = copyButton(text);
      copy.classList.add("src-copy");
      const extra: Array<HTMLElement | null> = [copy];

      const showCode = (): void => body.replaceChildren(codeView(text, path, ext, range));
      if (isMd) {
        const toggle = h("button", { class: "copy", type: "button", "aria-pressed": "true" }, "Code");
        let preview = true;
        const draw = (): void => {
          if (preview) {
            const md = h("div", { class: "markdown-body" });
            md.append(renderMarkdown(text, { owner: repo.owner, repo: repo.repo, ref: repo.ref }));
            decorateCode(md);
            body.replaceChildren(md);
            toggle.textContent = "Code";
          } else {
            showCode();
            highlightLines(range, false);
            toggle.textContent = "Preview";
          }
          toggle.setAttribute("aria-pressed", String(!preview));
        };
        toggle.addEventListener("click", () => {
          preview = !preview;
          draw();
        });
        extra.unshift(toggle);
        view.replaceChildren(head(path, extra), body);
        if (range) {
          preview = false;
          draw();
        } else draw();
      } else {
        view.replaceChildren(head(path, extra), body);
        showCode();
      }
      if (res.stale) body.prepend(h("p", { class: "muted small src-stale" }, `Saved copy · ${formatAge(res.ageMs)}`));
      highlightLines(range, true);
    } catch {
      if (current !== path) return;
      message(path, "Couldn't load this file. If you're offline, only files you opened before are available.");
    }
  }

  /* ---- search in code ---- */
  const marked = (text: string, needle: string): Array<string | HTMLElement> => {
    const out: Array<string | HTMLElement> = [];
    const lower = text.toLowerCase();
    let at = 0;
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
      if (i > at) out.push(text.slice(at, i));
      out.push(h("mark", {}, text.slice(i, i + needle.length)));
      at = i + needle.length;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  };

  async function search(q: string): Promise<void> {
    const token = ++searchToken;
    current = "";
    await ensureTree();
    if (token !== searchToken || files.length === 0) return;
    const needle = q.toLowerCase();
    const candidates = files.filter((f) => {
      const ext = extensionOf(f.path);
      return !BINARY_EXT.has(ext) && !IMAGE_EXT.has(ext) && f.size <= 100_000;
    }).slice(0, 300);
    const results = new Map<string, Array<{ n: number; text: string }>>();
    let hits = 0;
    let done = 0;
    let failed = 0;
    const progress = h("p", { class: "muted small src-loading" }, "");
    const out = h("div", { class: "src-results" });
    view.replaceChildren(h("div", { class: "src-view-head" }, h("div", { class: "src-breadcrumb" }, `Search “${q}”`)), progress, out);
    await pool(candidates, 6, async (f) => {
      try {
        const text = await readFileLight(repo, f.path);
        if (text !== null) {
          const found: Array<{ n: number; text: string }> = [];
          text.split("\n").forEach((line, idx) => {
            if (found.length < 5 && hits < 300 && line.toLowerCase().includes(needle)) {
              found.push({ n: idx + 1, text: line.trim().slice(0, 220) });
              hits++;
            }
          });
          if (found.length) results.set(f.path, found);
        }
      } catch {
        failed++;
      }
      progress.textContent = `Searching… ${++done}/${candidates.length} files · ${hits} match${hits === 1 ? "" : "es"}`;
    }, () => token !== searchToken || hits >= 300);
    if (token !== searchToken) return;
    progress.textContent = `${hits} match${hits === 1 ? "" : "es"} in ${results.size} file${results.size === 1 ? "" : "s"} (${candidates.length} files searched${files.length > candidates.length ? `, large/binary files skipped` : ""})${hits >= 300 ? " — showing the first 300" : ""}${failed ? ` · ${failed} couldn't be read (offline?)` : ""}.`;
    for (const [path, found] of [...results].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.append(
        h(
          "section",
          { class: "src-result" },
          h("a", { class: "src-result-file", href: sourceHash(path) }, path),
          ...found.map((m) => h("a", { class: "src-result-line", href: sourceHash(path, `:L${m.n}`) }, h("span", { class: "ln-n" }, String(m.n)), h("code", {}, ...marked(m.text, needle)))),
        ),
      );
    }
  }
  searchForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = searchInput.value.trim();
    if (q.length >= 2) void search(q);
  });

  // Line numbers are plain links (#source/path:L12); the lib page router calls show() on hashchange.
  view.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t?.classList.contains("ln") && (ev as MouseEvent).shiftKey) {
      const m = location.hash.match(/:L(\d+)(?:-\d+)?$/);
      const a = Number(m?.[1] ?? 0);
      const b = Number(t.dataset["n"] ?? 0);
      if (a && b && a !== b) {
        ev.preventDefault();
        const spec = decodeURIComponent(location.hash.slice("#source/".length)).replace(/:L\d+(?:-\d+)?$/, "");
        location.hash = sourceHash(spec, `:L${Math.min(a, b)}-${Math.max(a, b)}`);
      }
    }
  });

  function show(spec: string | null): void {
    pending = spec;
    void ensureTree().then(() => {
      if (files.length === 0) return;
      let { path, lines } = parseSourceSpec(spec ?? "");
      if (!path) {
        const prefer = ["Bit.hk", "bit.hk", "Bytes.hk", "README.md", "Readme.md", "readme.md"];
        path = prefer.find((p) => files.some((f) => f.path === p)) ?? files[0]?.path ?? "";
        lines = null;
      }
      if (path) void openFile(path, lines);
    });
  }

  return { show };
}

function findNode(root: Node, path: string): Node | null {
  let node: Node | undefined = root;
  for (const part of path.split("/")) {
    node = node?.children.get(part);
    if (!node) return null;
  }
  return node;
}

function fileIcon(name: string): string {
  const ext = extensionOf(name);
  if (["h#", "h#i", "hk", "hl", "hcs"].includes(ext)) return "⚡";
  if (["md", "markdown", "txt", "rst"].includes(ext)) return "📄";
  if (["json", "yml", "yaml", "toml", "lock"].includes(ext)) return "🔧";
  if (IMAGE_EXT.has(ext)) return "🖼";
  if (BINARY_EXT.has(ext)) return "🗂";
  return "📄";
}
