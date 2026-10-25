export type TokenKind =
  | "com" // comment
  | "doc" // documentation comment
  | "str" // string / char literal
  | "esc" // escape sequence inside a string
  | "num" // number
  | "kw" // keyword
  | "sec" // [section] header (hk)
  | "key" // key (hk)
  | "op" // operator / punctuation that carries meaning
  | "type" // type name
  | "fn" // function / command name
  | "attr" // attribute, annotation, flag, macro
  | "var" // variable
  | "const" // true / false / null / CONSTANT
  | "mod" // module path, import spec, file path
  | "";

export interface Token {
  kind: TokenKind;
  text: string;
}

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

class Out {
  readonly toks: Token[] = [];
  push(kind: TokenKind, text: string): void {
    if (!text) return;
    const last = this.toks[this.toks.length - 1];
    if (last && last.kind === kind) last.text += text;
    else this.toks.push({ kind, text });
  }
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
const isIdentChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

function sticky(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

/* =============================================================== generic code lexer */

interface CommentRule {
  start: string;
  /** undefined = until end of line */
  end?: string;
  kind: "com" | "doc";
  /** the rule does not apply when the character right after `start` is this one */
  notFollowedBy?: string;
}

interface CodeCfg {
  comments: CommentRule[];
  quotes: string[];
  backtick?: boolean;
  /** single-quoted char literal such as 'a' or '\n' (instead of a string that runs to the next quote) */
  charLiteral?: boolean;
  escape: RegExp;
  kw: Set<string>;
  consts: Set<string>;
  types: Set<string>;
  /** Capitalised identifier → type, ALL_CAPS → constant */
  capitals: boolean;
  fnDef: Set<string>;
  typeDef: Set<string>;
  attrs: RegExp[];
  /** identifier directly followed by `(` → function */
  calls: boolean;
  ops: RegExp;
  numRe: RegExp;
  hook?: (ctx: Ctx) => boolean;
}

interface Ctx {
  text: string;
  i: number;
  out: Out;
  /** last identifier/keyword seen with nothing but whitespace after it */
  prev: string;
  advance: (to: number) => void;
}

const NUM = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/y;
const NUM_SUFFIX = /(?:[iu](?:8|16|32|64|128|size)|f32|f64)\b/y;
const CHAR_LIT = /'(?:\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[^\n])|[^'\\\n])'/y;

function lexCode(text: string, cfg: CodeCfg): Token[] {
  const out = new Out();
  const n = text.length;
  let i = 0;
  let prev = "";
  const ctx: Ctx = { text, i: 0, out, prev: "", advance: (to) => (i = to) };

  while (i < n) {
    const c = text[i] as string;

    // comments
    let matched = false;
    for (const rule of cfg.comments) {
      if (!text.startsWith(rule.start, i)) continue;
      if (rule.notFollowedBy !== undefined && text[i + rule.start.length] === rule.notFollowedBy) continue;
      let end: number;
      if (rule.end === undefined) {
        const eol = text.indexOf("\n", i);
        end = eol === -1 ? n : eol;
      } else {
        const close = text.indexOf(rule.end, i + rule.start.length);
        end = close === -1 ? n : close + rule.end.length;
      }
      out.push(rule.kind, text.slice(i, end));
      i = end;
      matched = true;
      break;
    }
    if (matched) {
      prev = "";
      continue;
    }

    // language specific constructs
    if (cfg.hook) {
      ctx.i = i;
      ctx.prev = prev;
      if (cfg.hook(ctx)) {
        prev = "";
        continue;
      }
    }

    // strings
    if (cfg.quotes.includes(c)) {
      if (c === "'" && cfg.charLiteral) {
        const m = sticky(CHAR_LIT, text, i);
        if (m) {
          out.push("str", m[0]);
          i += m[0].length;
          prev = "";
          continue;
        }
        out.push("", c);
        i++;
        prev = "";
        continue;
      }
      out.push("str", c);
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") {
        if (text[j] === "\\") {
          const m = sticky(cfg.escape, text, j);
          if (m) {
            out.push("esc", m[0]);
            j += m[0].length;
            continue;
          }
          out.push("str", text.slice(j, j + 2));
          j += 2;
          continue;
        }
        let k = j;
        while (k < n && text[k] !== c && text[k] !== "\n" && text[k] !== "\\") k++;
        out.push("str", text.slice(j, k));
        j = k;
      }
      if (j < n && text[j] === c) {
        out.push("str", c);
        j++;
      }
      i = j;
      prev = "";
      continue;
    }
    if (c === "`" && cfg.backtick) {
      let j = i + 1;
      while (j < n && text[j] !== "`") {
        if (text[j] === "\\") j++;
        j++;
      }
      out.push("str", text.slice(i, Math.min(j + 1, n)));
      i = Math.min(j + 1, n);
      prev = "";
      continue;
    }

    // attributes / annotations
    let attr: RegExpExecArray | null = null;
    for (const re of cfg.attrs) {
      attr = sticky(re, text, i);
      if (attr) break;
    }
    if (attr) {
      out.push("attr", attr[0]);
      i += attr[0].length;
      prev = "";
      continue;
    }

    // numbers
    if (c >= "0" && c <= "9" && !isIdentChar(text[i - 1])) {
      const m = sticky(cfg.numRe, text, i);
      if (m) {
        let len = m[0].length;
        const suf = sticky(NUM_SUFFIX, text, i + len); // 1u8, 2.5f32 belong to the number
        if (suf) len += suf[0].length;
        out.push("num", text.slice(i, i + len));
        i += len;
        prev = "";
        continue;
      }
    }

    // identifiers
    if (/[A-Za-z_]/.test(c)) {
      const m = sticky(IDENT, text, i) as RegExpExecArray;
      const w = m[0];
      const next = text[i + w.length];
      let kind: TokenKind = "";
      if (cfg.fnDef.has(prev)) kind = "fn";
      else if (cfg.typeDef.has(prev)) kind = "type";
      else if (cfg.kw.has(w)) kind = "kw";
      else if (cfg.consts.has(w)) kind = "const";
      else if (cfg.types.has(w)) kind = "type";
      else if (cfg.capitals && /^[A-Z][A-Z0-9_]+$/.test(w)) kind = "const";
      else if (cfg.capitals && /^[A-Z]/.test(w)) kind = "type";
      else if (cfg.calls && (next === "(" || (next === " " && text[i + w.length + 1] === "("))) kind = "fn";
      out.push(kind, w);
      i += w.length;
      prev = w;
      continue;
    }

    // whitespace keeps `prev` alive; anything else resets it
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      out.push("", c);
      i++;
      continue;
    }
    const op = sticky(cfg.ops, text, i);
    if (op) {
      out.push("op", op[0]);
      i += op[0].length;
    } else {
      out.push("", c);
      i++;
    }
    prev = "";
  }
  return out.toks;
}

/* ====================================================================== H# (.h#, .h#i) */

const HSHARP: CodeCfg = {
  comments: [
    // `///` documentation (`////` is an ordinary comment), `;;` line comment,
    // `// … \\` multi-line comment, legacy `#` comment (anything but an attribute `#[`)
    { start: "///", kind: "doc", notFollowedBy: "/" },
    { start: ";;", kind: "com" },
    { start: "//", end: "\\\\", kind: "com" },
    { start: "#", kind: "com", notFollowedBy: "[" },
  ],
  quotes: ['"', "'"],
  charLiteral: true,
  escape: /\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\}|[^\n])/y,
  kw: words(
    "if is then else elsif end match while for in loop do break continue return unsafe async await fn let mut struct enum trait impl pub extern mod use from as new self type arena manual using write const",
  ),
  consts: words("true false nil"),
  types: words("int uint i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 bool string bytes void any"),
  capitals: true,
  fnDef: words("fn"),
  typeDef: words("struct enum trait impl"),
  // @arena @arc @pointers @safety @default @manual … and #[test] #[derive(..)]
  attrs: [/@[A-Za-z_][A-Za-z0-9_]*/y, /#\[[^\]\n]*\]/y],
  calls: true,
  ops: /->|=>|::|\.\.=?|[+\-*/%]=|==|!=|<=|>=|&&|\|\||[+\-*/%<>=!?&|^~]/y,
  numRe: NUM,
};

/* ================================================================== HackerScript (.hcs) */

const HACKERSCRIPT: CodeCfg = {
  comments: [
    // `!!! doc`, `!! comment`, `!> block <!`   (`!=` stays an operator)
    { start: "!!!", kind: "doc" },
    { start: "!!", kind: "com" },
    { start: "!>", end: "<!", kind: "com" },
  ],
  quotes: ['"', "'"],
  escape: /\\[ntr\\"'0e]/y,
  kw: words(
    "fun let const if else elif while for in return end get import using direct manual struct enum match break continue gc pub self and or not as impl include native region use async await spawn style",
  ),
  consts: words("true false null"),
  types: words("Int Float Str Bool List Dict Option Result Self Some None Ok Err"),
  capitals: true,
  fnDef: words("fun"),
  typeDef: words("struct enum impl"),
  // @hot_reload, @wasm_export
  attrs: [/@[A-Za-z_][A-Za-z0-9_]*/y],
  calls: true,
  ops: /->|::|&&|\|\||[+\-*/%]=|==|!=|<=|>=|[+\-*/%<>=!&|^~]/y,
  numRe: NUM,
  hook: hackerScriptHook,
};

/** `get <std:io>`, `use <lang:js>`, `include <x/y>`, `native {C++}`, `$ cmd $` sandbox. */
function hackerScriptHook(ctx: Ctx): boolean {
  const { text, i, out, prev } = ctx;
  const c = text[i];
  if (c === "<" && (prev === "get" || prev === "use" || prev === "include" || prev === "using")) {
    const m = sticky(/<[^>\n]*>/y, text, i);
    if (m) {
      out.push("mod", m[0]);
      ctx.advance(i + m[0].length);
      return true;
    }
  }
  if (c === "{" && prev === "native") {
    const m = sticky(/\{[^}\n]*\}/y, text, i);
    if (m) {
      out.push("type", m[0]);
      ctx.advance(i + m[0].length);
      return true;
    }
  }
  // `$ ls -la $` — only when the closing `$` is on the same line
  if (c === "$" && text[i + 1] === " ") {
    const eol = text.indexOf("\n", i);
    const line = text.slice(i, eol === -1 ? text.length : eol);
    const close = line.indexOf(" $", 1);
    if (close > 0) {
      out.push("op", "$");
      out.push("str", line.slice(1, close + 1));
      out.push("op", "$");
      ctx.advance(i + close + 2);
      return true;
    }
  }
  return false;
}

/* ============================================================= generic families (other files) */

const C_LIKE = words(
  "if else for while do switch case break continue return fn func function let var const mut static struct enum union impl trait type interface class new delete import export from use using mod pub public private protected extends implements package namespace async await yield try catch finally throw throws match in as is not and or void int float double bool char string self this super extern unsafe where loop default",
);
const SCRIPT = words(
  "if elif else fi then for while do done case esac in function return break continue local export source import set let end begin until unless and or not def class",
);
const GENERIC_CONSTS = words("true false null nil None True False undefined");

const generic = (over: Partial<CodeCfg>): CodeCfg => ({
  comments: [],
  quotes: ['"', "'"],
  escape: /\\[^\n]/y,
  kw: new Set(),
  consts: GENERIC_CONSTS,
  types: new Set(),
  capitals: false,
  fnDef: words("fn func function def"),
  typeDef: words("struct enum class trait interface type"),
  attrs: [],
  calls: false,
  ops: /->|=>|::|&&|\|\||==|!=|<=|>=|[+\-*/%<>=!&|^~?]/y,
  numRe: NUM,
  ...over,
});

const FAMILIES: Record<string, CodeCfg> = {
  c: generic({ comments: [{ start: "//", kind: "com" }, { start: "/*", end: "*/", kind: "com" }], backtick: true, kw: C_LIKE }),
  hash: generic({ comments: [{ start: "#", kind: "com" }], kw: SCRIPT }),
  lua: generic({ comments: [{ start: "--[[", end: "]]", kind: "com" }, { start: "--", kind: "com" }], kw: SCRIPT }),
  sql: generic({
    comments: [{ start: "--", kind: "com" }, { start: "/*", end: "*/", kind: "com" }],
    kw: words("select from where insert update delete create table join on group by order limit and or not null as into values set"),
  }),
  html: generic({ comments: [{ start: "<!--", end: "-->", kind: "com" }], consts: new Set(), ops: /[<>/=]/y }),
};

/* ================================================================ Hacker Lang (.hl) */

/** Prefixes that start a shell command line, longest first (the lexer's own order). */
const HL_CMD_PREFIXES = ["^->", "^>>", "->>", "^>", "->", "/>", ">>", ">", "&"];

const HL_IDENT = /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/y;
const HL_PATH = /(?:~|\.{1,2})?\/[A-Za-z0-9_.\-/*~]*|\.{1,2}(?=[\s/]|$)/y;
const HL_FLAG = /--?[A-Za-z][A-Za-z0-9_-]*(?:=[^\s"']*)?/y;

type InlineMode = "expr" | "shell" | "print";

/** `"…@var…\n…"` — the string itself plus the variables and escapes inside it. */
function hlString(out: Out, body: string): void {
  out.push("str", '"');
  let k = 1;
  while (k < body.length) {
    const ch = body[k] as string;
    if (ch === "\\" && k + 1 < body.length) {
      out.push("esc", body.slice(k, k + 2));
      k += 2;
    } else if (ch === "@" && /[A-Za-z0-9_]/.test(body[k + 1] ?? "")) {
      const m = sticky(HL_IDENT, body, k + 1) as RegExpExecArray;
      out.push("var", `@${m[0]}`);
      k += 1 + m[0].length;
    } else if (ch === "$") {
      const m = sticky(/\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/y, body, k);
      if (m) {
        out.push("var", m[0]);
        k += m[0].length;
      } else {
        out.push("str", ch);
        k++;
      }
    } else {
      let e = k + 1;
      while (e < body.length && body[e] !== "\\" && body[e] !== "@" && body[e] !== "$") e++;
      out.push("str", body.slice(k, e));
      k = e;
    }
  }
}

/** Strings, @variables, numbers, flags, pipes … inside one Hacker Lang line (after its prefix). */
function hlInline(out: Out, s: string, mode: InlineMode): void {
  const n = s.length;
  let i = 0;
  let wordStart = mode === "shell"; // the next bare word is a command name
  while (i < n) {
    const c = s[i] as string;

    if (c === "@" && /[A-Za-z0-9_]/.test(s[i + 1] ?? "")) {
      const m = sticky(HL_IDENT, s, i + 1) as RegExpExecArray;
      out.push("var", `@${m[0]}`);
      i += 1 + m[0].length;
      wordStart = false;
      continue;
    }
    if (mode === "print") {
      // print text is free-form: only @variables are special
      let j = i + 1;
      while (j < n && s[j] !== "@") j++;
      out.push("", s.slice(i, j));
      i = j;
      continue;
    }
    if (c === '"' || (c === "'" && mode === "shell")) {
      let j = i + 1;
      while (j < n && s[j] !== c) {
        if (s[j] === "\\") j++;
        j++;
      }
      const end = Math.min(j + 1, n);
      if (c === '"') hlString(out, s.slice(i, end));
      else out.push("str", s.slice(i, end));
      i = end;
      wordStart = false;
      continue;
    }
    if (c === "|" && s[i + 1] === ">") {
      out.push("op", "|>");
      i += 2;
      continue;
    }
    if (c === "$") {
      if (s[i + 1] === "(") {
        out.push("op", "$(");
        i += 2;
        wordStart = mode === "shell";
        continue;
      }
      const m = sticky(/\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9?#$!@*])/y, s, i);
      if (m) {
        out.push("var", m[0]);
        i += m[0].length;
        wordStart = false;
        continue;
      }
    }
    if (c === " " || c === "\t") {
      out.push("", c);
      i++;
      continue;
    }
    if (mode === "shell" && c === "-" && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) {
      const m = sticky(HL_FLAG, s, i);
      if (m) {
        out.push("attr", m[0]);
        i += m[0].length;
        wordStart = false;
        continue;
      }
    }
    if (mode === "shell" && (c === "/" || c === "~" || c === ".")) {
      const m = sticky(HL_PATH, s, i);
      if (m && m[0].length > 0) {
        out.push("mod", m[0]);
        i += m[0].length;
        wordStart = false;
        continue;
      }
    }
    if (c >= "0" && c <= "9" && !isIdentChar(s[i - 1]) && s[i - 1] !== "." && s[i - 1] !== "-") {
      const m = sticky(/\d+(?:\.\d+)?(?![A-Za-z_])/y, s, i);
      if (m) {
        out.push("num", m[0]);
        i += m[0].length;
        wordStart = false;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      const re = mode === "shell" ? /[A-Za-z_][A-Za-z0-9_.\-/:=,]*/y : IDENT;
      const w = (sticky(re, s, i) as RegExpExecArray)[0];
      let kind: TokenKind = "";
      if (w === "true" || w === "false") kind = "const";
      else if (mode === "shell" && wordStart) kind = "fn";
      else if (mode === "expr" && (w === "in" || w === "and" || w === "or" || w === "not")) kind = "kw";
      out.push(kind, w);
      i += w.length;
      wordStart = false;
      continue;
    }
    const op = sticky(/&&|\|\||>>|==|!=|<=|>=|->|[|;<>=!+\-*/%()&]/y, s, i);
    if (op) {
      out.push("op", op[0]);
      i += op[0].length;
      if (mode === "shell" && ["|", "&&", "||", ";", "("].includes(op[0])) wordStart = true;
      continue;
    }
    out.push("", c);
    i++;
  }
}

const hlName = (s: string, at: number): string => sticky(HL_IDENT, s, at)?.[0] ?? "";

/** `<main/colors> | detail` → module path + detail. */
function importTail(out: Out, s: string): void {
  const bar = s.indexOf("|");
  const spec = bar === -1 ? s : s.slice(0, bar);
  const trimmed = spec.replace(/\s+$/, "");
  out.push("mod", trimmed);
  out.push("", spec.slice(trimmed.length));
  if (bar !== -1) {
    out.push("op", "|");
    out.push("str", s.slice(bar + 1));
  }
}

function lexHackerLang(text: string): Token[] {
  const out = new Out();
  let inExportList = false;

  text.split("\n").forEach((line, idx) => {
    if (idx > 0) out.push("", "\n");
    const lead = (/^[ \t\r]*/.exec(line) as RegExpExecArray)[0];
    out.push("", lead);
    const s = line.slice(lead.length);
    if (s === "") return;

    const rest = (from: number): string => s.slice(from);
    const ws = (from: number): number => from + (/^[ \t]*/.exec(s.slice(from)) as RegExpExecArray)[0].length;

    // body of an export list:  => name [   | item   ]
    if (inExportList) {
      if (s.startsWith("]")) {
        out.push("op", "]");
        out.push("", rest(1));
        inExportList = false;
        return;
      }
      if (s.startsWith(";;;")) return void out.push("doc", s);
      if (s.startsWith(";;")) return void out.push("com", s);
      if (s.startsWith("|") && s[1] !== ">" && s[1] !== "|") {
        out.push("op", "|");
        hlInline(out, rest(1), "expr");
        return;
      }
    }

    // comments and shebang
    if (s.startsWith("#!")) return void out.push("com", s);
    if (s.startsWith("///") || s.startsWith(";;;")) return void out.push("doc", s);
    if (s.startsWith(";;")) return void out.push("com", s);

    // // tool [apt-package]   — dependency declaration
    if (s.startsWith("//")) {
      out.push("attr", "//");
      const p = ws(2);
      out.push("", s.slice(2, p));
      const lb = s.indexOf("[", p);
      const name = s.slice(p, lb === -1 ? s.length : lb);
      const trimmed = name.replace(/\s+$/, "");
      out.push("mod", trimmed);
      out.push("", name.slice(trimmed.length));
      if (lb !== -1) out.push("str", s.slice(lb));
      return;
    }

    // # <lib>  /  # <lib> | detail      — import
    if (s.startsWith("#")) {
      out.push("kw", "#");
      const p = ws(1);
      out.push("", s.slice(1, p));
      importTail(out, s.slice(p));
      return;
    }
    // << file | detail   /   <* directory
    if (s.startsWith("<<") || s.startsWith("<*")) {
      out.push("kw", s.slice(0, 2));
      const p = ws(2);
      out.push("", s.slice(2, p));
      importTail(out, s.slice(p));
      return;
    }

    // ~> print
    if (s.startsWith("~>")) {
      out.push("kw", "~>");
      hlInline(out, rest(2), "print");
      return;
    }

    // $( expr ) -> @var
    if (s.startsWith("$(")) {
      out.push("kw", "$(");
      let depth = 1;
      let j = 2;
      while (j < s.length && depth > 0) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") depth--;
        j++;
      }
      const close = depth === 0 ? j - 1 : j;
      hlInline(out, s.slice(2, close), "expr");
      if (depth === 0) out.push("kw", ")");
      hlInline(out, s.slice(j), "expr");
      return;
    }

    // :* goroutine
    if (s.startsWith(":*")) {
      out.push("kw", ":*");
      const m = /^(\s*)([A-Za-z0-9_-]*)(\s*)(def\b)?(.*)$/.exec(rest(2)) as RegExpExecArray;
      out.push("", m[1] ?? "");
      out.push("fn", m[2] ?? "");
      out.push("", m[3] ?? "");
      out.push("kw", m[4] ?? "");
      out.push("", m[5] ?? "");
      return;
    }
    // :: name <size> def   |   :: name args
    if (s.startsWith("::")) {
      out.push("kw", "::");
      let p = ws(2);
      out.push("", s.slice(2, p));
      const name = hlName(s, p);
      out.push("fn", name);
      p += name.length;
      const tail = s.slice(p);
      const arena = /^(\s*)(<[^>\n]*>)?(\s*)(def)\b(.*)$/.exec(tail);
      if (arena) {
        out.push("", arena[1] ?? "");
        out.push("num", arena[2] ?? "");
        out.push("", arena[3] ?? "");
        out.push("kw", arena[4] ?? "");
        out.push("com", arena[5] ?? "");
      } else {
        hlInline(out, tail, "shell");
      }
      return;
    }
    // :name def
    const fdef = /^:(\s*)([A-Za-z0-9_-]+)(\s+)def\b(.*)$/.exec(s);
    if (fdef) {
      out.push("kw", ":");
      out.push("", fdef[1] ?? "");
      out.push("fn", fdef[2] ?? "");
      out.push("", fdef[3] ?? "");
      out.push("kw", "def");
      out.push("com", fdef[4] ?? "");
      return;
    }

    // *-- channel operation   /   *> hsh command
    if (s.startsWith("*--")) {
      out.push("kw", "*--");
      const p = ws(3);
      out.push("", s.slice(3, p));
      const name = hlName(s, p);
      out.push("fn", name);
      hlInline(out, s.slice(p + name.length), "expr");
      return;
    }
    if (s.startsWith("*>")) {
      out.push("kw", "*>");
      hlInline(out, rest(2), "shell");
      return;
    }

    // -- function call
    if (s.startsWith("--")) {
      out.push("kw", "--");
      const p = ws(2);
      out.push("", s.slice(2, p));
      const name = hlName(s, p);
      out.push("fn", name);
      hlInline(out, s.slice(p + name.length), "expr");
      return;
    }

    // => export
    if (s.startsWith("=>")) {
      out.push("kw", "=>");
      const p = ws(2);
      out.push("", s.slice(2, p));
      const name = hlName(s, p);
      out.push("var", name);
      const after = s.slice(p + name.length);
      const eq = /^(\s*)(=)(.*)$/.exec(after);
      const lst = /^(\s*)(\[)(.*)$/.exec(after);
      if (eq) {
        out.push("", eq[1] ?? "");
        out.push("op", "=");
        hlInline(out, eq[3] ?? "", "expr");
      } else if (lst) {
        out.push("", lst[1] ?? "");
        out.push("op", "[");
        out.push("", lst[3] ?? "");
        inExportList = true;
      } else {
        out.push("", after);
      }
      return;
    }

    // _> file [runtime] def
    if (s.startsWith("_>")) {
      out.push("kw", "_>");
      let p = ws(2);
      out.push("", s.slice(2, p));
      const file = /^[^\s[]+/.exec(s.slice(p))?.[0] ?? "";
      out.push("mod", file);
      p += file.length;
      const m = /^(\s*)(\[[^\]\n]*\])?(\s*)(def\b)?(.*)$/.exec(s.slice(p)) as RegExpExecArray;
      out.push("", m[1] ?? "");
      out.push("type", m[2] ?? "");
      out.push("", m[3] ?? "");
      out.push("kw", m[4] ?? "");
      out.push("", m[5] ?? "");
      return;
    }

    // command lines: > >> ^> ^>> -> ->> ^-> /> &
    const prefix = HL_CMD_PREFIXES.find((p) => s.startsWith(p));
    if (prefix) {
      out.push("kw", prefix);
      hlInline(out, rest(prefix.length), "shell");
      return;
    }

    // % name: type = value
    if (s.startsWith("%")) {
      out.push("kw", "%");
      let p = ws(1);
      out.push("", s.slice(1, p));
      const name = hlName(s, p);
      out.push("var", name);
      p += name.length;
      const m = /^(\s*)(?::(\s*)([A-Za-z0-9_-]+))?(\s*)(=)?(.*)$/.exec(s.slice(p)) as RegExpExecArray;
      out.push("", m[1] ?? "");
      if (m[3] !== undefined) {
        out.push("op", ":");
        out.push("", m[2] ?? "");
        out.push("type", m[3]);
      }
      out.push("", m[4] ?? "");
      if (m[5]) out.push("op", "=");
      hlInline(out, m[6] ?? "", "expr");
      return;
    }

    // @ item in list   (for)   —   any other line with @name is a variable reference
    if (s.startsWith("@")) {
      const f = /^@(\s*)([A-Za-z0-9_-]+)(\s+)in\b(.*)$/.exec(s);
      if (f) {
        out.push("kw", "@");
        out.push("", f[1] ?? "");
        out.push("var", f[2] ?? "");
        out.push("", f[3] ?? "");
        out.push("kw", "in");
        hlInline(out, f[4] ?? "", "shell");
        return;
      }
      hlInline(out, s, "expr");
      return;
    }

    // ?~ cond   |   ? ok  |  ? err  |  ?switch x
    if (s.startsWith("?")) {
      if (s.startsWith("?~")) {
        out.push("kw", "?~");
        hlInline(out, rest(2), "expr");
        return;
      }
      const m = /^\?(\s*)([A-Za-z]+)(.*)$/.exec(s);
      if (m) {
        out.push("kw", "?");
        out.push("", m[1] ?? "");
        out.push("kw", m[2] ?? "");
        hlInline(out, m[3] ?? "", "expr");
        return;
      }
    }

    // done / using <gen 2>
    const kwLine = /^(done|using)\b(.*)$/.exec(s);
    if (kwLine) {
      out.push("kw", kwLine[1] ?? "");
      const tail = kwLine[2] ?? "";
      const g = /^(\s*)(<[^>\n]*>)(.*)$/.exec(tail);
      if (g) {
        out.push("", g[1] ?? "");
        out.push("mod", g[2] ?? "");
        out.push("com", g[3] ?? "");
      } else hlInline(out, tail, "expr");
      return;
    }
    // _3 — repeat the next line three times
    const rep = /^(_)(\d+)(?![A-Za-z0-9_])(.*)$/.exec(s);
    if (rep) {
      out.push("kw", "_");
      out.push("num", rep[2] ?? "");
      hlInline(out, rep[3] ?? "", "expr");
      return;
    }

    // switch arms, loose values, anything else
    hlInline(out, s, "expr");
  });
  return out.toks;
}

/* ============================================================================ hk (.hk) */

const HK_STRING = /"(?:\\.|[^"\\\n])*"?/y;

function lexHk(text: string): Token[] {
  const out = new Out();
  text.split("\n").forEach((line, idx) => {
    if (idx > 0) out.push("", "\n");
    const lead = (/^[ \t\r]*/.exec(line) as RegExpExecArray)[0];
    out.push("", lead);
    const s = line.slice(lead.length);
    if (s === "") return;

    if (s.startsWith("!") || s.startsWith(";;")) return void out.push("com", s);

    const sec = /^\[[^\]\n]*\]/.exec(s);
    if (sec) {
      out.push("sec", sec[0]);
      hkTail(out, s.slice(sec[0].length));
      return;
    }
    const arrow = /^(-+>)(\s*)(.*)$/.exec(s);
    if (arrow) {
      out.push("op", arrow[1] ?? "");
      out.push("", arrow[2] ?? "");
      const body = arrow[3] ?? "";
      const sep = body.indexOf("=>");
      const cmt = body.indexOf(";;");
      const keyEnd = sep !== -1 && (cmt === -1 || sep < cmt) ? sep : cmt !== -1 ? cmt : body.length;
      const keyText = body.slice(0, keyEnd);
      const key = keyText.replace(/\s+$/, "");
      out.push("key", key);
      out.push("", keyText.slice(key.length));
      if (keyEnd === sep) {
        out.push("op", "=>");
        hkTail(out, body.slice(keyEnd + 2));
      } else hkTail(out, body.slice(keyEnd));
      return;
    }
    hkTail(out, s);
  });
  return out.toks;
}

function hkTail(out: Out, s: string): void {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i] as string;
    if (c === ";" && s[i + 1] === ";") {
      out.push("com", s.slice(i));
      return;
    }
    if (c === '"') {
      const m = sticky(HK_STRING, s, i) as RegExpExecArray;
      out.push("str", m[0]);
      i += m[0].length;
      continue;
    }
    if (c === "[" || c === "]" || c === ",") {
      out.push("op", c);
      i++;
      continue;
    }
    if (c >= "0" && c <= "9" && !isIdentChar(s[i - 1])) {
      const m = sticky(/\d+(?:\.\d+)?(?![A-Za-z_.-])/y, s, i);
      if (m) {
        out.push("num", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z]/.test(c) && !isIdentChar(s[i - 1])) {
      const m = sticky(/[A-Za-z][A-Za-z0-9_]*/y, s, i) as RegExpExecArray;
      out.push(m[0] === "true" || m[0] === "false" ? "const" : "", m[0]);
      i += m[0].length;
      continue;
    }
    out.push("", c);
    i++;
  }
}

/* ============================================================================== public */

const BY_EXT: Record<string, Family> = {
  "h#": "hsharp", "h#i": "hsharp", hcs: "hackerscript", hl: "hackerlang", hk: "hk",
  js: "c", jsx: "c", ts: "c", tsx: "c", mjs: "c", cjs: "c", c: "c", h: "c", cpp: "c", cc: "c", hpp: "c", rs: "c", go: "c",
  java: "c", cs: "c", swift: "c", kt: "c", kts: "c", scala: "c", zig: "c", dart: "c", php: "c", css: "c", json: "c",
  py: "hash", rb: "hash", sh: "hash", bash: "hash", zsh: "hash", yml: "hash", yaml: "hash", toml: "hash", pl: "hash", r: "hash",
  cmake: "hash", mk: "hash", cfg: "hash", ini: "hash", gitignore: "hash",
  lua: "lua", sql: "sql", html: "html", htm: "html", xml: "html", svg: "html",
};

export type Family = "hsharp" | "hackerscript" | "hackerlang" | "hk" | "c" | "hash" | "lua" | "sql" | "html" | "plain";

/** Maps a Markdown fence language ("h#", "hacker lang", "bash", "rs"…) to a file extension the highlighter knows. */
export function extForLang(lang: string): string {
  const l = lang.toLowerCase().trim();
  const alias: Record<string, string> = {
    hsharp: "h#", "h-sharp": "h#", "h#": "h#", "h#i": "h#i", hsh: "h#",
    hackerlang: "hl", "hacker-lang": "hl", hacker_lang: "hl", "hacker lang": "hl", hl: "hl",
    hackerscript: "hcs", "hacker-script": "hcs", hacker_script: "hcs", "hacker script": "hcs", hs: "hcs", hcs: "hcs",
    hk: "hk", bit: "hk",
    shell: "sh", console: "sh", zsh: "sh", bash: "sh", javascript: "js", typescript: "ts", python: "py", rust: "rs",
    yaml: "yml", markdown: "md",
  };
  return alias[l] ?? l;
}

export function familyFor(ext: string, fileName: string): Family {
  if (fileName === "Makefile" || fileName === "Dockerfile") return "hash";
  if (fileName === "Bit.hk" || fileName === "bit.hk") return "hk";
  return BY_EXT[ext] ?? "plain";
}

export function highlight(text: string, ext: string, fileName: string): Token[] {
  const fam = familyFor(ext, fileName);
  switch (fam) {
    case "plain":
      return [{ kind: "", text }];
    case "hsharp":
      return lexCode(text, HSHARP);
    case "hackerscript":
      return lexCode(text, HACKERSCRIPT);
    case "hackerlang":
      return lexHackerLang(text);
    case "hk":
      return lexHk(text);
    default: {
      const cfg = FAMILIES[fam];
      return cfg ? lexCode(text, cfg) : [{ kind: "", text }];
    }
  }
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
