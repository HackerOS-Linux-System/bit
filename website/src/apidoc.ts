import { h } from "./dom.js";
import { GithubError } from "./github.js";
import { loadTree, pool, readFileLight, type Repo } from "./repodata.js";
import { cacheGet, cacheSet, formatAge, TTL, cacheAge } from "./store.js";
import { sourceHash } from "./source.js";

export type ApiKind = "fn" | "struct" | "enum" | "const";

export interface ApiItem {
  kind: ApiKind;
  name: string;
  sig: string;
  doc: string;
  line: number;
  file: string;
  members: string[];
}

const DECOR = /[─━═]{3,}|^;;\s*[-=*_]{3,}\s*$/;

function stripDoc(line: string): string {
  return line.replace(/^\s*;;\s?/, "");
}

/** Extracts the public API of one H# source file. Pure — unit-tested. */
export function parseHsharp(text: string, file: string, isInterface = false): ApiItem[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const items: ApiItem[] = [];
  let doc: string[] = [];
  const pub = isInterface ? "(?:pub\\s+)?" : "pub\\s+";
  const fnRe = new RegExp(`^${pub}fn\\s+(\\w+)\\s*(?:<[^>]*>)?\\s*\\(([\\s\\S]*?)\\)\\s*(?:->\\s*([^\\n]*?))?\\s*(?:\\bis\\b|$)`);
  const structRe = /^pub\s+(struct|enum)\s+(\w+)/;
  const constRe = /^pub\s+const\s+(\w+)\s*(?::\s*([^=\n]+?))?\s*(?:=\s*(.*))?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*;;/.test(line)) {
      if (DECOR.test(line)) doc = [];
      else doc.push(stripDoc(line));
      continue;
    }
    if (!line.trim()) {
      doc = [];
      continue;
    }
    const text0 = doc.join("\n").trim();

    if (new RegExp(`^${pub}fn\\s`).test(line)) {
      const chunk = lines.slice(i, i + 6).join(" ");
      const m = chunk.match(fnRe);
      if (m && m[1]) {
        const params = (m[2] ?? "").replace(/\s+/g, " ").trim();
        const ret = (m[3] ?? "").replace(/\s+is$/, "").trim();
        items.push({ kind: "fn", name: m[1], sig: `fn ${m[1]}(${params})${ret ? ` -> ${ret}` : ""}`, doc: text0, line: i + 1, file, members: [] });
      }
      doc = [];
      continue;
    }
    const st = line.match(structRe);
    if (st && st[1] && st[2]) {
      const members: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^end\b/.test(lines[j] ?? "")) {
        const l = (lines[j] ?? "").trim();
        if (l && !l.startsWith(";;")) members.push(l.replace(/\s+;;.*$/, ""));
        j++;
      }
      items.push({ kind: st[1] as ApiKind, name: st[2], sig: `${st[1]} ${st[2]}`, doc: text0, line: i + 1, file, members });
      i = j;
      doc = [];
      continue;
    }
    const c = line.match(constRe);
    if (c && c[1]) {
      items.push({ kind: "const", name: c[1], sig: `const ${c[1]}${c[2] ? `: ${c[2]}` : ""}${c[3] ? ` = ${c[3]}` : ""}`, doc: text0, line: i + 1, file, members: [] });
    }
    doc = [];
  }
  return items;
}

/** Plain-text doc → paragraphs with `code` spans (no Markdown engine needed, never HTML). */
function docNode(doc: string): HTMLElement {
  const box = h("div", { class: "api-doc" });
  for (const para of doc.split(/\n\s*\n/)) {
    const p = h("p", {});
    para
      .replace(/\n/g, " ")
      .split(/(`[^`]+`)/)
      .forEach((part) => p.append(part.startsWith("`") && part.endsWith("`") && part.length > 2 ? h("code", {}, part.slice(1, -1)) : document.createTextNode(part)));
    box.append(p);
  }
  return box;
}

const KIND_LABEL: Record<ApiKind, string> = { fn: "Functions", struct: "Structs", enum: "Enums", const: "Constants" };

function modName(file: string): string {
  return file.replace(/^src\//, "").replace(/\.h#i?$/, "");
}

export function mountApi(panel: HTMLElement, repo: Repo): { load: () => void } {
  const box = h("div", {}, h("p", { class: "muted" }, "Reading the sources…"));
  panel.append(box);
  let started = false;

  const run = async (): Promise<void> => {
    started = true;
    try {
      const cacheKey = `api:${repo.owner}/${repo.repo}@${repo.ref}`;
      let items = cacheGet<ApiItem[]>(cacheKey);
      let savedAge: number | null = null;
      if (!items) {
        const tree = await loadTree(repo);
        const files = (tree.value?.files ?? []).filter((f) => /\.h#i?$/.test(f.path) && f.size <= 200_000).slice(0, 150);
        if (!tree.value || files.length === 0) {
          box.replaceChildren(h("p", { class: "empty-note" }, tree.value ? "No .h# source files — the API view is generated from H# code (`pub fn`, `pub struct`)." : `Nothing found at "${repo.ref}".`));
          return;
        }
        const all: ApiItem[] = [];
        let done = 0;
        const progress = h("p", { class: "muted small" }, "");
        box.replaceChildren(progress);
        await pool(files, 6, async (f) => {
          const text = await readFileLight(repo, f.path);
          if (text) all.push(...parseHsharp(text, f.path, f.path.endsWith(".h#i")));
          progress.textContent = `Reading sources… ${++done}/${files.length}`;
        });
        items = all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
        cacheSet(cacheKey, items, TTL.TREE);
      } else savedAge = cacheAge(cacheKey);
      render(items, savedAge);
    } catch (e) {
      const limited = e instanceof GithubError;
      const retry = h("button", { class: "retry-btn", type: "button" }, "Try again");
      retry.addEventListener("click", () => {
        box.replaceChildren(h("p", { class: "muted" }, "Reading the sources…"));
        void run();
      });
      box.replaceChildren(
        h("p", { class: "muted" }, limited ? e.message : "Couldn't read the sources. If you're offline, open this tab once while online to save it."),
        h("div", { class: "lang-actions" }, retry, limited ? h("a", { class: "retry-btn", href: "settings.html" }, "Add token") : null),
      );
    }
  };

  function render(items: ApiItem[], savedAge: number | null): void {
    if (items.length === 0) {
      box.replaceChildren(h("p", { class: "empty-note" }, "No public items found (`pub fn`, `pub struct`, `pub enum`, `pub const`)."));
      return;
    }
    const filter = h("input", { class: "src-filter", type: "search", placeholder: "Filter by name or docs…", "aria-label": "Filter the API", autocomplete: "off" });
    const kinds = new Set<ApiKind>(["fn", "struct", "enum", "const"]);
    const chips = h("div", { class: "chips api-kinds" });
    const count = h("span", { class: "muted small" });
    const list = h("div", { class: "api-list" });

    const modules = new Map<string, ApiItem[]>();
    for (const it of items) (modules.get(it.file) ?? modules.set(it.file, []).get(it.file))?.push(it);

    const apply = (): void => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      list.querySelectorAll<HTMLDetailsElement>("details.api-mod").forEach((mod) => {
        let any = 0;
        mod.querySelectorAll<HTMLElement>("article.api-item").forEach((a) => {
          const ok = kinds.has(a.dataset["kind"] as ApiKind) && (!q || (a.dataset["text"] ?? "").includes(q));
          a.hidden = !ok;
          if (ok) any++;
        });
        mod.hidden = any === 0;
        if (q && any) mod.open = true;
        shown += any;
      });
      count.textContent = `${shown} of ${items.length} items`;
    };

    for (const k of ["fn", "struct", "enum", "const"] as ApiKind[]) {
      if (!items.some((i) => i.kind === k)) continue;
      const b = h("button", { class: "chip on", type: "button", "aria-pressed": "true" }, `${KIND_LABEL[k]} ${items.filter((i) => i.kind === k).length}`);
      b.addEventListener("click", () => {
        if (kinds.has(k)) kinds.delete(k);
        else kinds.add(k);
        b.classList.toggle("on", kinds.has(k));
        b.setAttribute("aria-pressed", String(kinds.has(k)));
        apply();
      });
      chips.append(b);
    }

    for (const [file, mod] of modules) {
      const d = h("details", { class: "api-mod", open: "" }, h("summary", {}, h("code", {}, modName(file)), h("span", { class: "muted small" }, `  ${mod.length} item${mod.length === 1 ? "" : "s"}`)));
      for (const it of mod) {
        const art = h(
          "article",
          { class: "api-item", id: `api-${modName(file).replace(/\W+/g, "-")}-${it.name}`, "data-kind": it.kind, "data-text": `${it.name} ${it.doc}`.toLowerCase() },
          h(
            "header",
            {},
            h("span", { class: `api-kind is-${it.kind}` }, it.kind),
            h("code", { class: "api-sig" }, it.sig),
            h("a", { class: "api-src", href: sourceHash(file, `:L${it.line}`) }, "source"),
          ),
        );
        if (it.doc) art.append(docNode(it.doc));
        if (it.members.length) art.append(h("ul", { class: "api-members" }, ...it.members.map((m) => h("li", {}, h("code", {}, m)))));
        d.append(art);
      }
      list.append(d);
    }
    box.replaceChildren(
      h("div", { class: "api-tools" }, filter, count, savedAge !== null ? h("span", { class: "muted small" }, `saved copy · ${formatAge(savedAge)}`) : null),
      chips,
      list,
    );
    filter.addEventListener("input", apply);
    apply();
  }

  return {
    load: () => {
      if (!started) void run();
    },
  };
}
