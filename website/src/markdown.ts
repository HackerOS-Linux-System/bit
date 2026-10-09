export interface MdContext {
  owner: string;
  repo: string;
  /** Tag, commit or "HEAD" — used to resolve relative links and images. */
  ref: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ stage 1 */

interface RefDef {
  url: string;
  title: string;
}
type Refs = Map<string, RefDef>;

const REF_DEF = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const HTML_BLOCK =
  /^\s{0,3}(?:<!--|<\/?(?:p|div|details|summary|center|h[1-6]|table|thead|tbody|tfoot|tr|td|th|caption|ul|ol|li|dl|dt|dd|picture|figure|figcaption|blockquote|section|hr|br|img|a)\b)/i;

function collectRefs(lines: string[]): { lines: string[]; refs: Refs } {
  const refs: Refs = new Map();
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const f = line.match(FENCE);
    if (fence === null && f && f[2]) fence = f[2][0] ?? null;
    else if (fence !== null && f && f[2] && f[2][0] === fence && !f[3]) fence = null;
    if (fence === null && !f) {
      const m = line.match(REF_DEF);
      if (m && m[1] && m[2]) {
        refs.set(m[1].toLowerCase().replace(/\s+/g, " "), { url: m[2], title: m[3] ?? m[4] ?? m[5] ?? "" });
        continue;
      }
    }
    kept.push(line);
  }
  return { lines: kept, refs };
}

function markdownToHtml(src: string): string {
  const all = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const { lines, refs } = collectRefs(all);
  return renderBlocks(lines, refs, false);
}

function isBlockStart(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || /^ {0,3}>/.test(line) || ITEM.test(line) || HR.test(line) || HTML_BLOCK.test(line);
}

function renderBlocks(lines: string[], refs: Refs, tight: boolean): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code
    const fence = line.match(FENCE);
    if (fence && fence[2]) {
      const mark = fence[2];
      const indent = (fence[1] ?? "").length;
      const lang = fence[3] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? "";
        const close = l.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1] && close[1][0] === mark[0] && close[1].length >= mark.length) break;
        code.push(l.replace(new RegExp(`^ {0,${indent}}`), ""));
        i++;
      }
      i++; // closing fence (an unterminated block runs to EOF)
      const cls = lang && /^[\w+#.-]{1,24}$/.test(lang) ? ` class="language-${lang}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // raw HTML block: passed through up to the next blank line (comments up to -->)
    if (HTML_BLOCK.test(line)) {
      const chunk: string[] = [];
      if (/^\s{0,3}<!--/.test(line)) {
        while (i < lines.length) {
          const l = lines[i] ?? "";
          chunk.push(l);
          i++;
          if (l.includes("-->")) break;
        }
        out.push(chunk.join("\n"));
        continue;
      }
      while (i < lines.length && (lines[i] ?? "").trim()) {
        chunk.push(lines[i] ?? "");
        i++;
      }
      out.push(chunk.join("\n"));
      continue;
    }

    // ATX heading
    const hd = line.match(HEADING);
    if (hd && hd[1]) {
      const n = hd[1].length;
      out.push(`<h${n}>${inline(hd[2] ?? "", refs)}</h${n}>`);
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // block quote
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (/^ {0,3}>/.test(l)) quoted.push(l.replace(/^ {0,3}>\s?/, ""));
        else if (l.trim() && quoted.length && !isBlockStart(l)) quoted.push(l); // lazy continuation
        else break;
        i++;
      }
      out.push(`<blockquote>${renderBlocks(quoted, refs, false)}</blockquote>`);
      continue;
    }

    // table
    const sep = lines[i + 1];
    if (line.includes("|") && sep !== undefined && isTableSeparator(sep)) {
      const header = splitRow(line);
      const aligns = splitRow(sep).map(cellAlign);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim() && (lines[i] ?? "").includes("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      out.push(renderTable(header, aligns, rows, refs));
      continue;
    }

    // list
    if (ITEM.test(line)) {
      const r = renderList(lines, i, refs);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // indented code (only where a paragraph cannot be continuing)
    if (/^ {4,}\S/.test(line)) {
      const code: string[] = [];
      while (i < lines.length && (/^ {4,}\S/.test(lines[i] ?? "") || !(lines[i] ?? "").trim())) {
        code.push((lines[i] ?? "").replace(/^ {4}/, ""));
        i++;
      }
      while (code.length && !(code[code.length - 1] ?? "").trim()) code.pop();
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // paragraph (or setext heading)
    const para: string[] = [];
    let setext = 0;
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim()) break;
      if (para.length) {
        const u = l.match(/^ {0,3}(=+|-+)\s*$/);
        if (u && u[1]) {
          setext = u[1].startsWith("=") ? 1 : 2;
          i++;
          break;
        }
        if (isBlockStart(l) && !ITEM.test(l)) break;
        if (ITEM.test(l) && /^(?:[-*+]|1[.)])\s/.test(l.trim())) break; // a list may interrupt a paragraph
      }
      para.push(l);
      i++;
    }
    if (para.length === 0) {
      i++; // never loop forever
      continue;
    }
    const html = inline(joinParagraph(para), refs);
    if (setext) out.push(`<h${setext}>${html}</h${setext}>`);
    else out.push(tight ? html : `<p>${html}</p>`);
  }
  return out.join("\n");
}

function joinParagraph(lines: string[]): string {
  return lines
    .map((l, idx) => {
      const last = idx === lines.length - 1;
      const t = l.replace(/^\s+/, "");
      if (last) return t.replace(/\s+$/, "");
      if (/ {2,}$/.test(t) || /\\$/.test(t)) return t.replace(/(?: {2,}|\\)$/, "") + "\u0001";
      return t.replace(/\s+$/, "");
    })
    .join("\n");
}

function renderList(lines: string[], start: number, refs: Refs): { html: string; next: number } {
  const first = (lines[start] ?? "").match(ITEM);
  const baseIndent = (first?.[1] ?? "").length;
  const ordered = /\d/.test(first?.[2] ?? "");
  const startNum = ordered ? parseInt(first?.[2] ?? "1", 10) : 1;
  const items: { lines: string[] }[] = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const m = (lines[i] ?? "").match(ITEM);
    if (!m || (m[1] ?? "").length !== baseIndent || /\d/.test(m[2] ?? "") !== ordered) break;
    const contentIndent = baseIndent + (m[2] ?? "").length + Math.min((m[3] ?? " ").length, 4);
    const body: string[] = [m[4] ?? ""];
    i++;
    let blank = false;
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim()) {
        blank = true;
        body.push("");
        i++;
        continue;
      }
      const ind = l.search(/\S/);
      if (ind >= contentIndent || (ind > baseIndent && !blank && !ITEM.test(l))) {
        body.push(l.slice(Math.min(ind, contentIndent)));
        blank = false;
        i++;
        continue;
      }
      if (!blank && ind > baseIndent) {
        // deeper-indented marker that still belongs to this item
        body.push(l.slice(Math.min(ind, contentIndent)));
        i++;
        continue;
      }
      break;
    }
    const trailingBlank = body.length > 0 && body[body.length - 1] === "";
    while (body.length && body[body.length - 1] === "") body.pop();
    const next = lines[i] ?? "";
    const continues = ITEM.test(next) && (next.match(ITEM)?.[1] ?? "").length === baseIndent;
    if (trailingBlank && continues) loose = true;
    items.push({ lines: body });
  }

  const lis = items.map((it) => {
    let text = it.lines[0] ?? "";
    let box = "";
    const task = text.match(/^\[([ xX])\]\s+/);
    if (task) {
      box = `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> `;
      text = text.slice(task[0].length);
    }
    const inner = renderBlocks([text, ...it.lines.slice(1)], refs, !loose);
    return `<li>${box}${inner}</li>`;
  });
  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : "";
  return { html: `<${tag}${startAttr}>${lis.join("")}</${tag}>`, next: i };
}

function isTableSeparator(line: string): boolean {
  return line.includes("-") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function cellAlign(spec: string): string {
  const s = spec.trim();
  if (/^:-+:$/.test(s)) return "center";
  if (/^-+:$/.test(s)) return "right";
  if (/^:-+$/.test(s)) return "left";
  return "";
}

function renderTable(header: string[], aligns: string[], rows: string[][], refs: Refs): string {
  const cell = (tag: string, c: string, idx: number): string => {
    const a = aligns[idx];
    return `<${tag}${a ? ` align="${a}"` : ""}>${inline(c, refs)}</${tag}>`;
  };
  const th = header.map((c, idx) => cell("th", c, idx)).join("");
  const trs = rows.map((r) => `<tr>${header.map((_, idx) => cell("td", r[idx] ?? "", idx)).join("")}</tr>`).join("");
  return `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/* ------------------------------------------------------------------- inline */

function inline(text: string, refs: Refs): string {
  const stash: string[] = [];
  const hold = (html: string): string => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let s = text;

  // `code spans` first — their content is literal
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t: string, code: string) => hold(`<code>${escapeHtml(code.trim())}</code>`));

  // <https://autolinks>
  s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, (_m, url: string) => hold(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`));

  // raw HTML tags and comments pass through (stage 2 sanitizes them)
  s = s.replace(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*>/g, (tag) => hold(tag));

  s = escapeHtml(s);

  const lookup = (label: string): RefDef | undefined => refs.get(label.toLowerCase().replace(/\s+/g, " "));
  const urlPart = String.raw`\(\s*(&lt;[^&]*?&gt;|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+&quot;(.*?)&quot;)?\s*\)`;

  // images: inline, then reference style
  s = s.replace(new RegExp(String.raw`!\[([^\]]*)\]` + urlPart, "g"), (_m, alt: string, url: string, title?: string) =>
    hold(`<img src="${cleanUrl(url)}" alt="${plain(alt)}"${title ? ` title="${title}"` : ""}>`),
  );
  s = s.replace(/!\[([^\]]*)\](?:\[([^\]]*)\])?/g, (m, alt: string, id?: string) => {
    const def = lookup(id || alt);
    return def ? hold(`<img src="${escapeHtml(def.url)}" alt="${plain(alt)}"${def.title ? ` title="${escapeHtml(def.title)}"` : ""}>`) : m;
  });

  // links: inline, then reference style, then [shortcut]
  s = s.replace(new RegExp(String.raw`\[([^\]]+)\]` + urlPart, "g"), (_m, label: string, url: string, title?: string) =>
    hold(`<a href="${cleanUrl(url)}"${title ? ` title="${title}"` : ""}>${label}</a>`),
  );
  s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, label: string, id: string) => {
    const def = lookup(id || label);
    return def ? hold(`<a href="${escapeHtml(def.url)}"${def.title ? ` title="${escapeHtml(def.title)}"` : ""}>${label}</a>`) : m;
  });
  s = s.replace(/\[([^\]]+)\]/g, (m, label: string) => {
    const def = lookup(label);
    return def ? hold(`<a href="${escapeHtml(def.url)}">${label}</a>`) : m;
  });

  // bare URLs
  s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<]*[^\s<.,:;"')\]!?])/g, (_m, pre: string, url: string) => `${pre}${hold(`<a href="${url}">${url}</a>`)}`);

  // emphasis
  s = s.replace(/\*\*\*([^*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/(^|[^\w])___([^_\n]+?)___(?!\w)/g, "$1<strong><em>$2</em></strong>");
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w])__([^_\n]+?)__(?!\w)/g, "$1<strong>$2</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");

  s = s.replace(/\u0001\n?/g, "<br>");

  // restore, innermost last (a stashed link label may itself contain stash markers)
  for (let pass = 0; pass < 5 && /\u0000\d+\u0000/.test(s); pass++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => stash[Number(n)] ?? "");
  }
  return s;
}

function cleanUrl(u: string): string {
  const t = u.startsWith("&lt;") && u.endsWith("&gt;") ? u.slice(4, -4) : u;
  return t;
}

function plain(s: string): string {
  return s.replace(/\u0000\d+\u0000/g, "").replace(/<[^>]*>/g, "");
}

/* ------------------------------------------------------------------ stage 2 */

const ALLOWED = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "center", "code", "dd", "del", "details", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li", "mark",
  "ol", "p", "pre", "s", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "u", "ul",
]);
/** Removed together with everything inside. */
const DROP = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "form", "svg", "math", "link", "meta", "base", "title", "head"]);
/** Unwrapped (children are kept). picture/source: GitHub's light/dark <img> pairs collapse to the fallback <img>. */
const SKIP_SELF = new Set(["source"]);

const ALIGN = new Set(["left", "right", "center", "justify"]);

function isSafeScheme(url: string, allowMailto: boolean): boolean {
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) return true; // relative
  const scheme = (m[1] ?? "").toLowerCase();
  return scheme === "https" || scheme === "http" || (allowMailto && scheme === "mailto");
}

function resolve(url: string, ctx: MdContext, kind: "link" | "media"): string | null {
  const u = url.trim();
  if (!u || /[\u0000-\u001f]/.test(u)) return null;
  if (u.startsWith("#")) return null; // handled by the caller
  if (u.startsWith("//")) return `https:${u}`;
  if (!isSafeScheme(u, kind === "link")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return u;
  // relative to the repository root (GitHub resolves them against the README's folder; READMEs live at the root)
  const clean = u.replace(/^\.\//, "").replace(/^\//, "");
  const ref = ctx.ref.split("/").map(encodeURIComponent).join("/");
  return kind === "media"
    ? `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${ref}/${clean}`
    : `https://github.com/${ctx.owner}/${ctx.repo}/blob/${ref}/${clean}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

const ID_PREFIX = "user-content-";

function sanitizeInto(parent: Node, source: Node, ctx: MdContext, slugs: Map<string, number>): void {
  for (const node of Array.from(source.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ""));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag) || SKIP_SELF.has(tag)) continue;
    if (!ALLOWED.has(tag)) {
      sanitizeInto(parent, el, ctx, slugs); // unwrap (picture, font, section…)
      continue;
    }

    if (tag === "input") {
      if (el.getAttribute("type") !== "checkbox") continue;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.disabled = true;
      box.checked = el.hasAttribute("checked");
      parent.appendChild(box);
      continue;
    }

    const out = document.createElement(tag);
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        out.setAttribute("href", `#${ID_PREFIX}${href.slice(1).toLowerCase()}`);
      } else {
        const r = resolve(href, ctx, "link");
        if (r) {
          out.setAttribute("href", r);
          out.setAttribute("target", "_blank");
          out.setAttribute("rel", "noopener noreferrer");
        }
      }
      const title = el.getAttribute("title");
      if (title) out.setAttribute("title", title);
    } else if (tag === "img") {
      const r = resolve(el.getAttribute("src") ?? "", ctx, "media");
      if (!r) continue;
      out.setAttribute("src", r);
      out.setAttribute("alt", el.getAttribute("alt") ?? "");
      out.setAttribute("loading", "lazy");
      out.setAttribute("referrerpolicy", "no-referrer");
      for (const a of ["width", "height"]) {
        const v = el.getAttribute(a);
        if (v && /^\d{1,4}%?$/.test(v)) out.setAttribute(a, v);
      }
      const title = el.getAttribute("title");
      if (title) out.setAttribute("title", title);
    } else if (/^h[1-6]$/.test(tag)) {
      const base = slugify(el.textContent ?? "") || "section";
      const n = slugs.get(base) ?? 0;
      slugs.set(base, n + 1);
      out.setAttribute("id", `${ID_PREFIX}${n ? `${base}-${n}` : base}`);
    } else if (tag === "code") {
      const cls = el.getAttribute("class");
      if (cls && /^language-[\w+#.-]{1,24}$/.test(cls)) out.setAttribute("class", cls);
    } else if (tag === "details" && el.hasAttribute("open")) {
      out.setAttribute("open", "");
    } else if (tag === "td" || tag === "th") {
      for (const a of ["colspan", "rowspan"]) {
        const v = el.getAttribute(a);
        if (v && /^\d{1,2}$/.test(v)) out.setAttribute(a, v);
      }
    }
    const align = (el.getAttribute("align") ?? "").toLowerCase();
    if (ALIGN.has(align) && ["p", "div", "td", "th", "img", "h1", "h2", "h3", "h4", "h5", "h6", "table"].includes(tag)) {
      out.setAttribute("align", align);
    }
    if (tag === "br" || tag === "hr" || tag === "img") {
      parent.appendChild(out);
      continue;
    }
    sanitizeInto(out, el, ctx, slugs);
    parent.appendChild(out);
  }
}

/** Renders Markdown into a detached, sanitized fragment ready to append. */
export function renderMarkdown(src: string, ctx: MdContext): DocumentFragment {
  const html = markdownToHtml(src);
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  const frag = document.createDocumentFragment();
  sanitizeInto(frag, doc.body, ctx, new Map());
  return frag;
}
