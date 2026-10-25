import { h } from "./dom.js";
import { GithubError } from "./github.js";
import { highlight, type Token } from "./highlight.js";
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
  /** `impl X` the item belongs to */
  owner?: string;
}

/** Source files the API tab understands: H# (+ interfaces), HackerScript, Hacker Lang. */
export const API_FILE = /\.(?:h#i?|hcs|hl)$/;

const DECOR = /[─━═]{3,}|^\s*(?:;;+|!!+|\/\/\/?)\s*[-=*_~#]{3,}\s*$/;

function cleanDoc(doc: string[]): string {
  return doc.join("\n").trim();
}

/* ------------------------------------------------------------------------------- H# */

/** Extracts the public API of one H# source file. Pure — unit-tested. */
export function parseHsharp(text: string, file: string, isInterface = false): ApiItem[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const items: ApiItem[] = [];
  let doc: string[] = [];
  let owner = "";
  const pub = isInterface ? "(?:pub\\s+)?" : "pub\\s+";
  const indent = isInterface ? "" : "[ \\t]*";
  const startFn = new RegExp(`^${indent}${pub}fn\\s`);
  const fnRe = new RegExp(`^\\s*${pub}fn\\s+(\\w+)\\s*(?:<[^>]*>)?\\s*\\(([\\s\\S]*?)\\)\\s*(?:->\\s*([^\\n]*?))?\\s*(?:\\bis\\b|$)`);
  const structRe = /^pub\s+(struct|enum)\s+(\w+)/;
  const constRe = /^pub\s+const\s+(\w+)\s*(?::\s*([^=\n]+?))?\s*(?:=\s*(.*))?$/;
  const docLine = /^\s*(?:;;|\/\/\/(?!\/))/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (docLine.test(line)) {
      if (DECOR.test(line)) doc = [];
      else doc.push(line.replace(/^\s*(?:;;|\/\/\/)\s?/, ""));
      continue;
    }
    if (!line.trim()) {
      doc = [];
      continue;
    }
    const text0 = cleanDoc(doc);

    const impl = line.match(/^impl\s+(\w+)/);
    if (impl && impl[1]) {
      owner = impl[1];
      doc = [];
      continue;
    }
    if (owner && /^end\b/.test(line)) {
      owner = "";
      doc = [];
      continue;
    }

    if (startFn.test(line)) {
      const chunk = lines.slice(i, i + 6).join(" ");
      const m = chunk.match(fnRe);
      if (m && m[1]) {
        const params = (m[2] ?? "").replace(/\s+/g, " ").trim();
        const ret = (m[3] ?? "").replace(/\s+is$/, "").trim();
        const item: ApiItem = { kind: "fn", name: owner ? `${owner}.${m[1]}` : m[1], sig: `fn ${m[1]}(${params})${ret ? ` -> ${ret}` : ""}`, doc: text0, line: i + 1, file, members: [] };
        if (owner) item.owner = owner;
        items.push(item);
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
        if (l && !/^(?:;;|\/\/\/)/.test(l)) members.push(l.replace(/\s+(?:;;|\/\/\/).*$/, ""));
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

/* ------------------------------------------------------------------ HackerScript */

/** Public API of one HackerScript (.hcs) file: `fun`, `struct`, `enum`, `const`, `impl` methods, `region` externs. Pure. */
export function parseHackerScript(text: string, file: string): ApiItem[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const items: ApiItem[] = [];
  let doc: string[] = [];
  let owner = "";
  let inRegion = false;
  const docLine = /^\s*!!!?(?!>)/;
  const fnRe = /^\s*(?:pub\s+)?fun\s+(\w+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*(?:->\s*([^[\n]*?))?\s*(?:\[|$)/;
  const typeRe = /^(?:pub\s+)?(struct|enum)\s+(\w+)/;
  const constRe = /^(?:pub\s+)?const\s+(\w+)\s*(?::\s*([^=\n]+?))?\s*(?:=\s*(.*))?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*!>/.test(line) && !line.includes("<!")) {
      // block comment: skip to its end
      while (i < lines.length && !(lines[i] ?? "").includes("<!")) i++;
      doc = [];
      continue;
    }
    if (docLine.test(line)) {
      if (DECOR.test(line)) doc = [];
      else doc.push(line.replace(/^\s*!!!?\s?/, ""));
      continue;
    }
    if (!line.trim()) {
      doc = [];
      continue;
    }
    const text0 = cleanDoc(doc);

    const impl = line.match(/^impl\s+(\w+)/);
    if (impl && impl[1]) {
      owner = impl[1];
      doc = [];
      continue;
    }
    if (/^region\s*\[/.test(line)) {
      inRegion = true;
      doc = [];
      continue;
    }
    if ((owner || inRegion) && /^\]/.test(line)) {
      owner = "";
      inRegion = false;
      doc = [];
      continue;
    }

    const nested = owner !== "" || inRegion;
    if ((nested ? /^\s+(?:pub\s+)?fun\s/ : /^(?:pub\s+)?fun\s/).test(line)) {
      const chunk = lines.slice(i, i + 6).join(" ");
      const m = chunk.match(fnRe);
      if (m && m[1] && !m[1].startsWith("_")) {
        const params = (m[2] ?? "").replace(/\s+/g, " ").trim();
        const ret = (m[3] ?? "").replace(/\s+$/, "").trim();
        const item: ApiItem = {
          kind: "fn",
          name: owner ? `${owner}.${m[1]}` : m[1],
          sig: `${/^\s*pub\s/.test(line) ? "pub " : ""}fun ${m[1]}(${params})${ret ? ` -> ${ret}` : ""}`,
          doc: text0,
          line: i + 1,
          file,
          members: [],
        };
        if (owner) item.owner = owner;
        items.push(item);
      }
      doc = [];
      continue;
    }
    const st = line.match(typeRe);
    if (st && st[1] && st[2]) {
      const members: string[] = [];
      let j = i + 1;
      if (line.includes("[") && !/\]\s*$/.test(line)) {
        while (j < lines.length && !/^\]/.test(lines[j] ?? "")) {
          const l = (lines[j] ?? "").trim();
          if (l && !/^!!/.test(l)) members.push(l.replace(/\s+!!.*$/, "").replace(/,$/, ""));
          j++;
        }
      }
      items.push({ kind: st[1] as ApiKind, name: st[2], sig: `${/^pub\s/.test(line) ? "pub " : ""}${st[1]} ${st[2]}`, doc: text0, line: i + 1, file, members });
      i = Math.max(i, j);
      doc = [];
      continue;
    }
    const c = !nested ? line.match(constRe) : null;
    if (c && c[1] && !c[1].startsWith("_")) {
      items.push({ kind: "const", name: c[1], sig: `const ${c[1]}${c[2] ? `: ${c[2]}` : ""}${c[3] ? ` = ${c[3]}` : ""}`, doc: text0, line: i + 1, file, members: [] });
    }
    doc = [];
  }
  return items;
}

/* ------------------------------------------------------------------- Hacker Lang */

/**
 * Public API of one Hacker Lang (.hl) file: functions (`:name def`, `:: name <size> def`, `:* name def`),
 * exports (`=> name = value`, `=> name [ | a | b ]`) and top-level `% NAME = value` constants.
 * Names starting with `_` are private, like in the standard libraries. Pure.
 */
export function parseHackerLang(text: string, file: string): ApiItem[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const items: ApiItem[] = [];
  let doc: string[] = [];
  const docLine = /^(?:\/\/\/|;;)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (docLine.test(line)) {
      if (DECOR.test(line)) doc = [];
      else doc.push(line.replace(/^(?:\/\/\/|;;;?)\s?/, ""));
      continue;
    }
    if (!line.trim()) {
      doc = [];
      continue;
    }
    const text0 = cleanDoc(doc);

    const fn = line.match(/^:(?:(\*)|(:))?\s*([A-Za-z0-9_-]+)\s*(<[^>\n]*>)?\s*def\b/);
    if (fn && fn[3]) {
      if (!fn[3].startsWith("_")) {
        const lead = fn[1] ? ":*" : fn[2] ? "::" : ":";
        items.push({ kind: "fn", name: fn[3], sig: `${lead} ${fn[3]}${fn[4] ? ` ${fn[4]}` : ""} def`, doc: text0, line: i + 1, file, members: [] });
      }
      doc = [];
      continue;
    }
    const ex = line.match(/^=>\s*([A-Za-z0-9_-]+)\s*(?:(=)\s*(.*)|(\[))?/);
    if (ex && ex[1]) {
      if (ex[4]) {
        const members: string[] = [];
        let j = i + 1;
        while (j < lines.length && !/^\s*\]/.test(lines[j] ?? "")) {
          const l = (lines[j] ?? "").trim();
          if (l.startsWith("|") && !l.startsWith("|>")) members.push(l.slice(1).trim());
          j++;
        }
        items.push({ kind: "const", name: ex[1], sig: `=> ${ex[1]} [ … ]`, doc: text0, line: i + 1, file, members });
        i = j;
      } else {
        items.push({ kind: "const", name: ex[1], sig: `=> ${ex[1]}${ex[2] ? ` = ${(ex[3] ?? "").trim()}` : ""}`, doc: text0, line: i + 1, file, members: [] });
      }
      doc = [];
      continue;
    }
    const v = line.match(/^%\s*([A-Za-z0-9_-]+)\s*(?::\s*([A-Za-z0-9_-]+))?\s*=\s*(.*)$/);
    if (v && v[1] && !v[1].startsWith("_")) {
      items.push({ kind: "const", name: v[1], sig: `% ${v[1]}${v[2] ? `: ${v[2]}` : ""} = ${(v[3] ?? "").trim()}`, doc: text0, line: i + 1, file, members: [] });
    }
    doc = [];
  }
  return items;
}

/** One file → its API items, by extension. */
export function parseApiFile(text: string, file: string): ApiItem[] {
  if (/\.hcs$/.test(file)) return parseHackerScript(text, file);
  if (/\.hl$/.test(file)) return parseHackerLang(text, file);
  return parseHsharp(text, file, file.endsWith(".h#i"));
}

/** Highlighted children for a signature / member line. */
function code(text: string, file: string): HTMLElement {
  const ext = file.endsWith(".h#i") ? "h#i" : file.endsWith(".hcs") ? "hcs" : file.endsWith(".hl") ? "hl" : "h#";
  const tokens: Token[] = highlight(text, ext, "");
  return h("code", { class: "api-sig" }, ...tokens.map((t) => (t.kind ? h("span", { class: `tok-${t.kind}` }, t.text) : document.createTextNode(t.text))));
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
  return file.replace(/^(?:src|lib|cmd)\//, "").replace(/\.(?:h#i?|hcs|hl)$/, "");
}

export function mountApi(panel: HTMLElement, repo: Repo): { load: () => void } {
  const box = h("div", {}, h("p", { class: "muted" }, "Reading the sources…"));
  panel.append(box);
  let started = false;

  const run = async (): Promise<void> => {
    started = true;
    try {
      const cacheKey = `api2:${repo.owner}/${repo.repo}${repo.dir ? `/${repo.dir}` : ""}@${repo.ref}`;
      let items = cacheGet<ApiItem[]>(cacheKey);
      let savedAge: number | null = null;
      if (!items) {
        const tree = await loadTree(repo);
        const files = (tree.value?.files ?? []).filter((f) => API_FILE.test(f.path) && f.size <= 200_000).slice(0, 150);
        if (!tree.value || files.length === 0) {
          box.replaceChildren(h("p", { class: "empty-note" }, tree.value ? "No H#, HackerScript or Hacker Lang sources (.h#, .hcs, .hl) — the API view is generated from their public functions, types and constants." : `Nothing found at "${repo.ref}".`));
          return;
        }
        const all: ApiItem[] = [];
        let done = 0;
        const progress = h("p", { class: "muted small" }, "");
        box.replaceChildren(progress);
        await pool(files, 6, async (f) => {
          const text = await readFileLight(repo, f.path);
          if (text) all.push(...parseApiFile(text, f.path));
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
      box.replaceChildren(h("p", { class: "empty-note" }, "No public items found (H#: `pub fn` / `pub struct` / `pub const` · HackerScript: `fun` / `struct` / `const` · Hacker Lang: `: name def`, `=> export`, `% CONST`)."));
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
            code(it.sig, file),
            it.owner ? h("span", { class: "api-owner muted small" }, `impl ${it.owner}`) : null,
            h("a", { class: "api-src", href: sourceHash(file, `:L${it.line}`) }, "source"),
          ),
        );
        if (it.doc) art.append(docNode(it.doc));
        if (it.members.length) art.append(h("ul", { class: "api-members" }, ...it.members.map((m) => h("li", {}, code(m, file)))));
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
