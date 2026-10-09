export type TokenKind = "com" | "str" | "num" | "kw" | "sec" | "key" | "op" | "";

export interface Token {
  kind: TokenKind;
  text: string;
}

interface Syntax {
  line: string[]; // line-comment starters
  block?: [string, string];
  quotes: string[];
  keywords: Set<string>;
}

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const C_LIKE = words(
  "if else for while do switch case break continue return fn func function let var const mut static struct enum union impl trait type interface class new delete import export from use using mod pub public private protected extends implements package namespace async await yield try catch finally throw throws match in as is not and or true false null nil void int float double bool char string self this super extern unsafe where loop default",
);
const SCRIPT = words(
  "if elif else fi then for while do done case esac in function return break continue local export source import true false null set let end begin until unless and or not def class",
);

const HSHARP = words(
  "fn is end let mut pub struct enum mod if else elif then while for in return break continue match as using use const loop true false and or not self",
);

const FAMILIES: Record<string, Syntax> = {
  hsharp: { line: [";;"], quotes: ['"', "'"], keywords: HSHARP },
  c: { line: ["//"], block: ["/*", "*/"], quotes: ['"', "'"], keywords: C_LIKE },
  hash: { line: ["#"], quotes: ['"', "'"], keywords: SCRIPT },
  hk: { line: [";;"], quotes: ['"'], keywords: words("true false") },
  lua: { line: ["--"], block: ["--[[", "]]"], quotes: ['"', "'"], keywords: SCRIPT },
  sql: { line: ["--"], block: ["/*", "*/"], quotes: ['"', "'"], keywords: words("select from where insert update delete create table join on group by order limit and or not null") },
  html: { line: [], block: ["<!--", "-->"], quotes: ['"', "'"], keywords: new Set() },
  plain: { line: [], quotes: [], keywords: new Set() },
};

const BY_EXT: Record<string, keyof typeof FAMILIES> = {
  "h#": "hsharp", "h#i": "hsharp", hcs: "c", hl: "c",
  js: "c", jsx: "c", ts: "c", tsx: "c", mjs: "c", cjs: "c", c: "c", h: "c", cpp: "c", cc: "c", hpp: "c", rs: "c", go: "c",
  java: "c", cs: "c", swift: "c", kt: "c", scala: "c", zig: "c", dart: "c", php: "c", css: "c", json: "c",
  py: "hash", rb: "hash", sh: "hash", bash: "hash", zsh: "hash", yml: "hash", yaml: "hash", toml: "hash", pl: "hash", r: "hash",
  cmake: "hash", mk: "hash", cfg: "hash", ini: "hash", gitignore: "hash",
  hk: "hk",
  lua: "lua", sql: "sql", html: "html", htm: "html", xml: "html", svg: "html",
};

/** Maps a Markdown fence language ("h#", "bash", "rs"…) to a file extension the highlighter knows. */
export function extForLang(lang: string): string {
  const l = lang.toLowerCase();
  const alias: Record<string, string> = {
    hsharp: "h#", "h-sharp": "h#", hackerlang: "hl", hackerscript: "hcs", hs: "hcs",
    shell: "sh", console: "sh", zsh: "sh", bash: "sh", javascript: "js", typescript: "ts", python: "py", rust: "rs",
    yaml: "yml", markdown: "md",
  };
  return alias[l] ?? l;
}

export function familyFor(ext: string, fileName: string): keyof typeof FAMILIES {
  if (fileName === "Makefile" || fileName === "Dockerfile") return "hash";
  return BY_EXT[ext] ?? "plain";
}

export function highlight(text: string, ext: string, fileName: string): Token[] {
  const fam = familyFor(ext, fileName);
  const syn = FAMILIES[fam] ?? FAMILIES["plain"];
  if (!syn || fam === "plain") return [{ kind: "", text }];
  const out: Token[] = [];
  let plainStart = 0;
  let i = 0;
  const n = text.length;

  const flush = (end: number): void => {
    if (end > plainStart) pushPlain(out, text.slice(plainStart, end), syn);
  };
  const emit = (kind: TokenKind, from: number, to: number): void => {
    flush(from);
    out.push({ kind, text: text.slice(from, to) });
    plainStart = to;
    i = to;
  };

  // [section] headers and `->` / `-->` keys of .hk manifests
  const atLineStart = (p: number): boolean => p === 0 || text[p - 1] === "\n";

  while (i < n) {
    const c = text[i] as string;

    if (fam === "hk" && atLineStart(i)) {
      const eol = text.indexOf("\n", i);
      const end = eol === -1 ? n : eol;
      const line = text.slice(i, end);
      const sec = line.match(/^\s*\[[^\]]+\]/);
      if (sec) {
        emit("sec", i, i + sec[0].length);
        continue;
      }
      const key = line.match(/^(\s*-{1,2}>\s*)([^=\n;]*?)(\s*=>|\s*$)/);
      if (key && key[1] !== undefined && key[2] !== undefined) {
        emit("op", i, i + key[1].length);
        emit("key", i, i + key[2].length);
        continue;
      }
      if (/^\s*!/.test(line)) {
        emit("com", i, end);
        continue;
      }
    }

    if (syn.block && text.startsWith(syn.block[0], i)) {
      const close = text.indexOf(syn.block[1], i + syn.block[0].length);
      emit("com", i, close === -1 ? n : close + syn.block[1].length);
      continue;
    }
    const lc = syn.line.find((t) => text.startsWith(t, i));
    if (lc !== undefined && !(lc === "#" && fam === "hash" && text[i + 1] === "!" && i > 0)) {
      const eol = text.indexOf("\n", i);
      emit("com", i, eol === -1 ? n : eol);
      continue;
    }
    if (syn.quotes.includes(c)) {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        j++;
      }
      emit("str", i, Math.min(j + 1, n));
      continue;
    }
    if (c === "`" && fam === "c") {
      let j = i + 1;
      while (j < n && text[j] !== "`") {
        if (text[j] === "\\") j++;
        j++;
      }
      emit("str", i, Math.min(j + 1, n));
      continue;
    }
    i++;
  }
  flush(n);
  return out;
}

/** Numbers and keywords inside text that is neither comment nor string. */
function pushPlain(out: Token[], s: string, syn: Syntax): void {
  const re = /\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_]*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const w = m[0];
    const kind: TokenKind = /^\d|^0x/.test(w) ? "num" : syn.keywords.has(w) ? "kw" : "";
    if (kind === "") continue;
    if (m.index > last) out.push({ kind: "", text: s.slice(last, m.index) });
    out.push({ kind, text: w });
    last = m.index + w.length;
  }
  if (last < s.length) out.push({ kind: "", text: s.slice(last) });
}

/** Splits a token stream into lines (tokens that span newlines are cut). */
export function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const t of tokens) {
    const parts = t.text.split("\n");
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1]?.push({ kind: t.kind, text: part });
    });
  }
  return lines;
}
