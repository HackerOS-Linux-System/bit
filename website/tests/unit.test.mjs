import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const HACKERC = process.env.HACKERC || "hackerc";
let b; // window.bitio
let win;

before(() => {
  const out = mkdtempSync(join(tmpdir(), "bitio-probe-"));
  const res = spawnSync(HACKERC, ["website", "probe.hcs", "-o", out], { cwd: here, encoding: "utf8" });
  const log = `${res.stdout}${res.stderr}`;
  assert.ok(!/hackerc-self\]|hackerc: /.test(log), `compile errors:\n${log}`);
  const html = readFileSync(join(out, "index.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://bit.test/", runScripts: "outside-only", pretendToBeVisual: true });
  win = dom.window;
  win.matchMedia = () => ({ matches: false });
  win.TextEncoder = TextEncoder;
  win.TextDecoder = TextDecoder;
  win.crypto.subtle || Object.defineProperty(win, "crypto", { value: globalThis.crypto });
  win.eval(readFileSync(join(out, "app.js"), "utf8"));
  b = win.bitio;
  assert.ok(b && typeof b.parse_hk === "function", "probe loaded");
});

// jsdom oddziela realm: porownujemy przez JSON, zeby deepEqual nie sprawdzal prototypow
const plain = (v) => JSON.parse(JSON.stringify(v));

test("parseHk reads sections, arrows and sub-keys", () => {
  const doc = plain(b.parse_hk(`[package]\n-> name => mold ;; comment\n-> authors => ["a", "b"]\n[dependencies]\n-> tui => *\n-> mine\n--> path => ../mine\n`));
  assert.equal(doc.package.name, "mold");
  assert.deepEqual(plain(b.hk_list(doc.package.authors)), ["a", "b"]);
  assert.equal(doc.dependencies.tui, "*");
  assert.equal(doc.dependencies["mine.path"], "../mine");
});

test("parseLenient tolerates trailing commas but not inside strings", () => {
  assert.deepEqual(plain(b.parse_lenient('{"a": [1, 2,], "b": "x,}",}')), { a: [1, 2], b: "x,}" });
});

test("dependenciesOf / classifyDep / manifestChanges", () => {
  const a = b.parse_hk("[package]\n-> version => 1.0.0\n[dependencies]\n-> tui => *\n-> old => *\n");
  const c = b.parse_hk("[package]\n-> version => 1.1.0\n[dependencies]\n-> tui => rev v2\n-> x => git https://github.com/u/x v1\n");
  const deps = plain(b.dependencies_of(c));
  assert.deepEqual(deps.map((d) => d.name), ["tui", "x"]);
  const libs = [{ name: "tui" }];
  assert.equal(b.classify_dep(deps[0], libs).kind, "index");
  assert.equal(b.classify_dep(deps[1], libs).kind, "git");
  const ch = plain(b.manifest_changes(a, c));
  assert.ok(ch.includes("version 1.0.0 → 1.1.0"));
  assert.ok(ch.some((x) => x.startsWith("~ dependency tui")));
  assert.ok(ch.some((x) => x.startsWith("+ dependency x")));
  assert.ok(ch.some((x) => x.startsWith("− dependency old")));
});

test("diffLines keeps changes with context and collapses the rest", () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const c = [...a];
  c[10] = "changed";
  const d = plain(b.diff_lines(a, c, 1));
  assert.deepEqual(d.map((x) => x.t), [" ", "-", "+", " "]);
  assert.ok(d.some((x) => x.t === "-" && x.s === "l10"));
  assert.ok(d.some((x) => x.t === "+" && x.s === "changed"));
  assert.ok(d.length < 10);
  assert.equal(b.diff_lines(new Array(2000).fill("x"), [], 2), null);
});

test("language detection covers .hk .hcs .h# .hl", () => {
  assert.equal(b.extension_of("src/main.h#"), "h#");
  assert.equal(b.extension_of("Bit.hk"), "hk");
  assert.equal(b.extension_of("Makefile"), "");
  const files = [
    { path: "a.h#", size: 800 }, { path: "b.hl", size: 100 }, { path: "c.hcs", size: 50 },
    { path: "Bit.hk", size: 50 }, { path: "README.md", size: 9999 },
  ];
  const r = plain(b.breakdown_from_files(files));
  assert.deepEqual(r.map((x) => x.name), ["H#", "Hacker Lang", "HackerScript", "hk"]);
  assert.equal(Math.round(r[0].pct), 80);
});

test("parseHsharp extracts the public API of real H# sources", () => {
  const src = readFileSync(join(here, "..", "..", "src", "semver.h#"), "utf8");
  const items = plain(b.parse_hsharp(src, "src/semver.h#", false));
  const parse = items.find((i) => i.name === "parse");
  assert.ok(parse, "pub fn parse found");
  assert.equal(parse.kind, "fn");
  assert.equal(parse.sig, "fn parse(tag: string) -> int");
  assert.match(parse.doc, /packed int/);
  assert.ok(!items.some((i) => i.name === "digits"), "private fn is not listed");
  const st = plain(b.parse_hsharp(";; A thing.\npub struct Thing is\n    pub a: int\n    pub b: string ;; note\nend\n", "x.h#", false));
  assert.equal(st[0].kind, "struct");
  assert.deepEqual(st[0].members, ["pub a: int", "pub b: string"]);
  assert.equal(st[0].doc, "A thing.");
});

test("combineChecksum equals bit's real directory checksum", async (t) => {
  if (spawnSync("sha256sum", ["--version"]).status !== 0) return t.skip("sha256sum not available");
  const dir = mkdtempSync(join(tmpdir(), "bitsum-"));
  const files = { "Bit.hk": "[package]\n-> name => x\n", "src/main.h#": "fn main() is end\n", "src/Zed.h#": "z", ".hidden": "h", "a b.txt": "spaces", "lib/ü.h#": "utf8" };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  const expected = execFileSync(
    "bash",
    ["-c", "cd \"$1\" && find . -type f -not -path './.git/*' -not -path './.bit/*' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1", "_", dir],
    { encoding: "utf8" },
  ).trim();
  const hashes = [];
  for (const [p, c] of Object.entries(files)) hashes.push({ path: p, hex: await b.sha256_str(c) });
  assert.equal(await b.combine_checksum(hashes), expected);
});

test("parseGithub understands repositories and sub-directories (libhammer, blue-api)", () => {
  const g = (u) => plain(b.parse_github(u));
  const strip = (x) => ({ owner: x.owner, repo: x.repo, ...(x.ref_ ? { ref: x.ref_ } : {}), ...(x.dir ? { dir: x.dir } : {}) });
  assert.deepEqual(strip(g("https://github.com/bit-io/mold")), { owner: "bit-io", repo: "mold" });
  assert.deepEqual(strip(g("https://github.com/bit-io/mold.git")), { owner: "bit-io", repo: "mold" });
  assert.deepEqual(strip(g("https://github.com/bit-io/mold/")), { owner: "bit-io", repo: "mold" });
  assert.deepEqual(strip(g("https://github.com/HackerOS-Linux-System/hammer/tree/main/libhammer")), { owner: "HackerOS-Linux-System", repo: "hammer", ref: "main", dir: "libhammer" });
  assert.deepEqual(strip(g("https://github.com/HackerOS-Linux-System/Blue-Environment/tree/main/api/")), { owner: "HackerOS-Linux-System", repo: "Blue-Environment", ref: "main", dir: "api" });
  assert.deepEqual(strip(g("https://github.com/o/r/tree/v1.2/libs/a%20b/x")), { owner: "o", repo: "r", ref: "v1.2", dir: "libs/a b/x" });
  assert.deepEqual(strip(g("https://github.com/o/r/tree/main")), { owner: "o", repo: "r", ref: "main" });
  assert.equal(g("https://github.com/o/r/tree/main/../x").dir, "", "no path traversal");
  assert.equal(b.parse_github("https://gitlab.com/o/r"), null);
});

test("repoPath / rawUrl / githubUrl prefix the library directory", () => {
  const r = new b.Repo("o", "r", "main", "libhammer");
  assert.equal(b.repo_path(r, "src/a.h#"), "libhammer/src/a.h#");
  assert.equal(b.raw_url(r, "src/a.h#"), "https://raw.githubusercontent.com/o/r/main/libhammer/src/a.h%23");
  assert.equal(b.github_url(r, "tree", ""), "https://github.com/o/r/tree/main/libhammer");
  assert.equal(b.github_url(r, "blob", "README.md"), "https://github.com/o/r/blob/main/libhammer/README.md");
  const plainRepo = new b.Repo("o", "r", "HEAD", "");
  assert.equal(b.github_url(plainRepo, "tree", ""), "https://github.com/o/r/tree/HEAD");
  assert.equal(b.raw_url(plainRepo, "Bit.hk"), "https://raw.githubusercontent.com/o/r/HEAD/Bit.hk");
});

test("language brands: real icons for H#, HackerScript and Hacker Lang; HackerScript is dark grey", () => {
  assert.equal(b.brand_for("H#").icon, "https://raw.githubusercontent.com/HackerOS-Linux-System/H-Sharp/main/images/icon.png");
  assert.equal(b.brand_for("HackerScript").icon, "https://raw.githubusercontent.com/HackerOS-Linux-System/HackerScript/main/images/icon.png");
  assert.equal(b.brand_for("Hacker Lang").icon, "https://raw.githubusercontent.com/HackerOS-Linux-System/Hacker-Lang/main/images/icon.png");
  assert.equal(b.brand_for("hk"), null);
  assert.equal(b.brand_for("Rust"), null);
  const hex = b.color_for_language("HackerScript");
  const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.ok(r === g || Math.abs(r - g) < 8, "grey");
  assert.ok(Math.max(r, g, bl) < 0x70, "dark");
  assert.ok(b.needs_outline("HackerScript"));
});

const kinds = (toks) => plain(toks).filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`);

test("highlighter never loses or invents text (every language)", () => {
  const samples = {
    "h#": 'using "2026"\n/// doc\npub fn f(x: int) -> int is\n  // block\n  more \\\\\n  return x ;; c\nend\n@arena\n#[test]\n"unterminated',
    hcs: '!> block\n<!\n!!! d\nget <std:io>\nfun main() [\n  let s = "a\\n" !! c\n  $ ls $\n]\n',
    hl: '#!/usr/bin/env hl\n;;; doc\n# <main/x>\n> ls -la |> @o\n=> E [\n  | a\n]\n: f def\ndone\n_3\n',
    hk: "[a]\n-> k => v ;; c\n! c\n--> p => [a, b]\n",
    rs: 'fn main() { let s = "x"; /* c */ }',
  };
  for (const [ext, src] of Object.entries(samples)) {
    assert.equal(plain(b.highlight(src, ext, "")).map((t) => t.text).join(""), src, ext);
  }
});

test("H# highlighting follows the real lexer (doc, block and legacy comments, attributes, escapes)", () => {
  const k = kinds(b.highlight('/// d\n;; c\n// a\nb \\\\ x\n# old\n#[test]\n@arena\nfn go(n: u8) -> Vec is let s = "a\\n" end', "h#", ""));
  assert.ok(k.includes("doc:/// d"));
  assert.ok(k.includes("com:;; c"));
  assert.ok(k.includes("com:// a\nb \\\\"), "// … \\\\ is one comment");
  assert.ok(k.includes("com:# old"), "legacy # comment");
  assert.ok(k.includes("attr:#[test]"));
  assert.ok(k.includes("attr:@arena"));
  assert.ok(k.includes("fn:go"));
  assert.ok(k.includes("type:u8"));
  assert.ok(k.includes("type:Vec"));
  assert.ok(k.includes("esc:\\n"));
  assert.ok(plain(b.highlight("//// not a doc comment\n", "h#", "")).every((t) => t.kind !== "doc"));
});

test("HackerScript highlighting: !! !!! !> <! comments, get <std:io>, fun names, native {C++}", () => {
  const k = kinds(b.highlight('!! c\n!!! d\n!> b\nb <!\nget <std:io> import <a::b>\nuse <lang:js>\npub fun add(a: Int) -> Result<Int, Str> [ end a != 1 ]\nnative {C++} [ ]\nlet t = true', "hcs", ""));
  for (const want of ["com:!! c", "doc:!!! d", "com:!> b\nb <!", "mod:<std:io>", "mod:<lang:js>", "fn:add", "type:Int", "type:{C++}", "const:true", "op:!="]) {
    assert.ok(k.includes(want), `missing ${want}`);
  }
});

test("Hacker Lang highlighting covers the line prefixes of the lexer", () => {
  const k = kinds(b.highlight(
    [
      "#!/usr/bin/env hl", ";;; doc", ";; c", "/// d", "// ninja [ninja-build]", "using <gen 2>", "# <main/colors> | x", "<< ./lib.hl", "<* dir",
      "% n: int = 42", "~> hi @n", "$( 1 + @n ) -> @r", "> ls -la /tmp | grep a |> @o", "^> id -u", "/> cat f", "& sleep 1",
      ":: hr 60", ": f def", ":: arena <1024> def", ":* worker def", "-- f", "*-- ch", "*> hsh cmd", "_> run.sh [shell] def",
      "=> NAME = v", "@ x in a b", "?~ @n < 5", "? ok", "?switch @n", "_3", "done",
    ].join("\n"), "hl", ""));
  for (const want of [
    "com:#!/usr/bin/env hl", "doc:;;; doc", "com:;; c", "doc:/// d", "attr://", "mod:ninja", "kw:using", "mod:<gen 2>",
    "kw:#", "mod:<main/colors>", "kw:<<", "kw:<*", "kw:%", "var:n", "type:int", "num:42", "kw:~>", "var:@n", "kw:$(", "var:@r",
    "fn:ls", "attr:-la", "mod:/tmp", "fn:grep", "op:|>", "var:@o", "kw:^>", "kw:/>", "kw:&", "kw:::", "fn:hr", "fn:f", "kw:def",
    "num:<1024>", "kw::*", "fn:worker", "kw:--", "kw:*--", "kw:*>", "kw:_>", "mod:run.sh", "type:[shell]", "kw:=>", "var:NAME",
    "kw:@", "kw:in", "kw:?~", "kw:?", "kw:ok", "kw:_", "kw:done",
  ]) {
    assert.ok(k.includes(want), `missing ${want}`);
  }
});

test("hk highlighting: sections, keys, values, comments", () => {
  const k = kinds(b.highlight('[package]\n-> name => "x"\n--> n => 3 ;; c\n! whole line\n', "hk", "Bit.hk"));
  for (const want of ["sec:[package]", "op:->", "key:name", "op:=>", 'str:"x"', "op:-->", "key:n", "num:3", "com:;; c", "com:! whole line"]) {
    assert.ok(k.includes(want), `missing ${want}`);
  }
});

test("fence names map to the right highlighter", () => {
  for (const [lang, fam] of [["h#", "hsharp"], ["hsharp", "hsharp"], ["H-Sharp", "hsharp"], ["hackerscript", "hackerscript"], ["hs", "hackerscript"], ["hcs", "hackerscript"], ["Hacker Lang", "hackerlang"], ["hacker-lang", "hackerlang"], ["hl", "hackerlang"], ["hk", "hk"], ["bash", "hash"], ["javascript", "c"]]) {
    assert.equal(b.family_for(b.ext_for_lang(lang), ""), fam, lang);
  }
});

test("API parser: HackerScript (fun / struct / enum / impl / const / region, !!! !! docs)", () => {
  const src = [
    "!! Joins two path segments.", "!! Never doubles the slash.", "pub fun path_join(a: Str,", "                   b: Str) -> Str [", "    end a + b", "]",
    "fun _private() [ ]", "", "!!! A point.", "pub struct Point [", "    x: Int,", "    y: Int", "]", "enum Shape [", "    Circle(Float),", "    Empty", "]",
    "impl Point [", "    !! Length.", "    fun length(self) -> Float [", "        end 1.0", "    ]", "]", "const PI: Float = 3.14", "region [", "    fun add(a: Int, b: Int) -> Int", "]",
  ].join("\n");
  const items = plain(b.parse_hackerscript(src, "lib/path.hcs"));
  const by = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(by["path_join"].sig, "pub fun path_join(a: Str, b: Str) -> Str");
  assert.match(by["path_join"].doc, /Never doubles/);
  assert.ok(!by["_private"], "underscore = private");
  assert.deepEqual(by["Point"].members, ["x: Int", "y: Int"]);
  assert.equal(by["Point"].doc, "A point.");
  assert.deepEqual(by["Shape"].members, ["Circle(Float)", "Empty"]);
  assert.equal(by["Point.length"].owner, "Point");
  assert.equal(by["Point.length"].doc, "Length.");
  assert.equal(by["PI"].sig, "const PI: Float = 3.14");
  assert.equal(by["add"].kind, "fn", "extern declared in a region");
});

test("API parser: Hacker Lang (functions, arena fns, exports, constants)", () => {
  const src = [
    ";;; main/str.hl — string helpers", "using <gen 2>", "", "% STR_NEWLINE = \\n", "% _hidden = 1", "% COUNT: int = 3", "",
    "/// Upper-cases @_str.", ": str_to_upper def", "    > echo hi", "done", ":: arena_fn <4096> def", "done", ":* worker def", "done", ": _private def", "done",
    "=> VERSION = 1.0", "=> LIST [", "  | a", "  | b", "]",
  ].join("\n");
  const items = plain(b.parse_hackerlang(src, "main-libs/str.hl"));
  const by = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(by["str_to_upper"].sig, ": str_to_upper def");
  assert.equal(by["str_to_upper"].doc, "Upper-cases @_str.");
  assert.equal(by["arena_fn"].sig, ":: arena_fn <4096> def");
  assert.equal(by["worker"].sig, ":* worker def");
  assert.ok(!by["_private"] && !by["_hidden"]);
  assert.equal(by["STR_NEWLINE"].sig, "% STR_NEWLINE = \\n");
  assert.equal(by["COUNT"].sig, "% COUNT: int = 3");
  assert.equal(by["VERSION"].sig, "=> VERSION = 1.0");
  assert.deepEqual(by["LIST"].members, ["a", "b"]);
});

test("API parser: H# methods in impl blocks and /// docs", () => {
  const items = plain(b.parse_hsharp("/// A stack.\nimpl Stack is\n    /// Push.\n    pub fn push(self, v: int) is\n    end\nend\npub fn top() -> int is\nend\n", "x.h#", false));
  const push = items.find((i) => i.name === "Stack.push");
  assert.ok(push);
  assert.equal(push.owner, "Stack");
  assert.equal(push.doc, "Push.");
  assert.ok(items.find((i) => i.name === "top"));
  assert.equal(b.parse_api_file("pub fun a() [ ]", "a.hcs")[0].name, "a");
  assert.equal(b.parse_api_file(": a def\ndone", "a.hl")[0].name, "a");
});

test("app downloads point at the v0.3 release assets; HackerOS gets the unpack command", () => {
  assert.equal(b.APP_ANDROID_URL, "https://github.com/HackerOS-Linux-System/bit/releases/download/v0.3/bit-io-android-app.apk");
  assert.equal(b.APP_IOS_URL, "https://github.com/HackerOS-Linux-System/bit/releases/download/v0.3/bit-io-ios-app.ipa");
  assert.equal(b.HACKEROS_COMMAND, "hacker unpack bit-app");
});

// ---- Markdown: sanitizacja (nowe testy; renderer jest teraz w HackerScript) ----
test("markdown: scripts and event handlers are dropped, relative links resolve to GitHub", () => {
  const r = new b.Repo("o", "r", "main", "lib");
  const frag = b.render_markdown('# T\n\n<script>window.PWNED=1</script><b onclick="x">ok</b> [a](docs/a.md) ![i](x.png) [bad](javascript:alert(1))', r);
  const div = win.document.createElement("div");
  div.append(frag);
  assert.ok(!div.querySelector("script"));
  assert.ok(!div.querySelector("[onclick]"));
  assert.ok(!win.PWNED);
  assert.equal(div.querySelector("a").getAttribute("href"), "https://github.com/o/r/blob/main/lib/docs/a.md");
  assert.equal(div.querySelector("img").getAttribute("src"), "https://raw.githubusercontent.com/o/r/main/lib/x.png");
  assert.ok(![...div.querySelectorAll("a")].some((a) => (a.getAttribute("href") || "").startsWith("javascript:")));
  assert.equal(div.querySelector("h1").id, "user-content-t");
});

test("markdown: lists, tables, task lists and fences", () => {
  const r = new b.Repo("o", "r", "main", "");
  const div = win.document.createElement("div");
  div.append(b.render_markdown("- a\n- b\n  - c\n\n1. x\n2. y\n\n| h | i |\n|---|:-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n```hcs\nfun f() [ ]\n```\n", r));
  assert.equal(div.querySelectorAll("ul").length, 3);
  assert.equal(div.querySelectorAll("ol > li").length, 2);
  assert.equal(div.querySelectorAll("th").length, 2);
  assert.equal(div.querySelector('td[align="center"]').textContent, "2");
  assert.equal(div.querySelectorAll('input[type="checkbox"]').length, 2);
  assert.ok(div.querySelector("pre code.language-hcs"));
});

// ---- jsutil.hcs / platform.hcs: zastepniki dawnego glue.js (czysty HackerScript) ----
test("json_parse equals JSON.parse on valid input (incl. the real index) and returns null on invalid input", () => {
  const valid = ['{"a":1,"b":[1,2.5,-3e2,true,false,null],"c":{"d":"x"}}', "[]", "{}", '"str"', "12", "  [1 , 2 ]  ",
    '{"s":"a\\nb\\t\\"q\\" \\u00e9 \\\\ \\/"}', '{"k":""}', "[[],{},[{}]]", JSON.stringify({ text: "x\n".repeat(5000), n: [1, 2, 3] }),
    readFileSync(join(here, "..", "..", "index", "repository.json"), "utf8").replace(/,(\s*[}\]])/g, "$1")];
  for (const s of valid) assert.deepEqual(plain(b.json_parse(s)), JSON.parse(s), s.slice(0, 40));
  for (const bad of ['{"a":}', "[1,2", '{"a" 1}', "tru", '"abc', '{"a":1,}', "[1,]", "", "x", '{"a":1} x', '"\\q"', '"\\u12"']) {
    assert.equal(b.json_parse(bad), null, `invalid: ${bad}`);
  }
});

test("json_parse is fast enough for a 6000-file tree (cache reads)", () => {
  const big = JSON.stringify({ tree: Array.from({ length: 6000 }, (_, i) => ({ path: `src/dir${i}/file${i}.h#`, size: i, mode: "100644" })) });
  const t0 = Date.now();
  assert.equal(b.json_parse(big).tree.length, 6000);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
});

test("object helpers: is_null sees undefined, js_get never throws or returns undefined", () => {
  assert.ok(b.is_null(undefined) && b.is_null(null) && !b.is_null(0) && !b.is_null(""));
  const o = JSON.parse('{"a":"s","n":0,"o":{"x":1}}');
  assert.equal(b.js_get(o, "zz"), null);
  assert.equal(b.js_str(o, "a"), "s");
  assert.equal(b.js_str(o, "n"), "");
  assert.equal(b.js_get(o, "n"), 0);
  assert.equal(b.js_has("str", "length"), false);
  assert.equal(b.js_has(null, "x"), false);
});

test("regex helpers: groups, non-global replace with $1, replace-with-function, split, sticky", () => {
  assert.deepEqual(plain(b.re_match("a(b)?(c)", "", "xac")), ["ac", "", "c"]);
  assert.equal(b.re_replace("(a)(b)", "", "abab ab", "[$2$1]"), "[ba]ab ab", "non-global replaces the first match, $n works");
  assert.equal(b.re_replace("(a)", "g", "banana", "<$1>"), "b<a>n<a>n<a>");
  assert.equal(b.re_replace("x", "", "aaa", "y"), "aaa");
  assert.equal(b.re_replace("^\\s+", "", "  hi  ", ""), "hi  ");
  assert.equal(b.re_replace_fn("(\\d)(x)?", "g", "1x 2 3x", (m) => `[${m[1]}${m[2]}]`), "[1x] [2] [3x]");
  assert.equal(b.re_replace_fn("a*", "g", "baac", (m) => `<${m[0]}>`), "baac".replace(/a*/g, (m) => `<${m}>`));
  assert.deepEqual(plain(b.re_split("\\s*,\\s*", "", "a , b,c")), ["a", "b", "c"]);
  assert.deepEqual(plain(b.re_sticky("\\d+", "ab12", 2)), ["12"]);
  assert.equal(b.re_sticky("\\d+", "ab12", 0), null);
});

test("URL helpers never throw: dec_uri, safe_url, qs_get, qs_build", () => {
  assert.equal(b.dec_uri("a%20b%2Fc"), "a b/c");
  assert.equal(b.dec_uri("%E2%9C%93"), "✓");
  assert.equal(b.dec_uri("100%"), "100%");
  assert.equal(b.dec_uri("%zz"), "%zz");
  assert.ok(b.dec_uri("%C3%28").includes("\ufffd"));
  assert.equal(b.safe_url("https://a.b/c?d=1"), "https://a.b/c?d=1");
  assert.equal(b.safe_url("javascript:alert(1)"), "#");
  assert.equal(b.safe_url("https://a b"), "#");
  assert.equal(b.qs_build(["q", "a b", "t", "x&y"]), "q=a%20b&t=x%26y");
});

test("storage helpers never throw: blocked localStorage (file://, cookies off) and replaceState errors", () => {
  const desc = Object.getOwnPropertyDescriptor(win, "localStorage");
  Object.defineProperty(win, "localStorage", { configurable: true, get() { throw new win.DOMException("denied", "SecurityError"); } });
  const hist = win.history.replaceState;
  win.history.replaceState = () => { throw new win.DOMException("origin null", "SecurityError"); };
  try {
    assert.equal(b.ls_get("k"), null);
    assert.equal(b.ls_set("k", "v"), false);
    assert.equal(b.ls_remove("k"), false);
    assert.equal(b.replace_url("?q=x"), false);
    assert.equal(b.try_call(() => { throw new Error("x"); }), false);
    assert.equal(b.try_call(() => {}), true);
  } finally {
    if (desc) Object.defineProperty(win, "localStorage", desc); else delete win.localStorage;
    win.history.replaceState = hist;
  }
});

test("localStorage helper reports a full storage as false instead of throwing", () => {
  assert.equal(b.ls_set("k", "v"), true);
  assert.equal(b.ls_get("k"), "v");
  assert.equal(b.ls_set("big", "x".repeat(5000000)), false);
  assert.equal(b.ls_get("big"), null);
  b.ls_remove("k");
  assert.equal(b.ls_get("k"), null);
});

test("http: network failure -> status 0; token only as header; rate-limit headers parsed", async () => {
  const saved = win.fetch;
  try {
    win.fetch = async () => { throw new Error("offline"); };
    assert.equal((await b.http("https://x", null)).status, 0);
    win.fetch = async (u, init) => ({ status: 200, ok: true, headers: { entries: () => [["x-ratelimit-remaining", "7"], ["x-ratelimit-limit", "60"]] }, text: async () => JSON.stringify(init.headers || {}) });
    const r = await b.http("https://api", "tok");
    assert.equal(JSON.parse(r.text).Authorization, "Bearer tok");
    assert.equal(r.rl.remaining, 7);
    assert.equal((await b.http("https://raw", null)).text, "{}", "no token -> no headers");
  } finally { win.fetch = saved; }
});

test("dom_add flattens lists, turns strings into text and skips null/false", () => {
  const d = win.document.createElement("div");
  b.dom_add(d, ["a", 1, null, false, [win.document.createElement("b"), ["c"]]]);
  assert.equal(d.innerHTML, "a1<b></b>c");
});
