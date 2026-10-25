import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const js = (m) => import(join(here, "..", "dist", "js", `${m}.js`));

test("parseHk reads sections, arrows and sub-keys", async () => {
  const { parseHk, hkList } = await js("hk");
  const doc = parseHk(`[package]\n-> name => mold ;; comment\n-> authors => ["a", "b"]\n[dependencies]\n-> tui => *\n-> mine\n--> path => ../mine\n`);
  assert.equal(doc.package.name, "mold");
  assert.deepEqual(hkList(doc.package.authors), ["a", "b"]);
  assert.equal(doc.dependencies.tui, "*");
  assert.equal(doc.dependencies["mine.path"], "../mine");
});

test("parseLenient tolerates trailing commas but not inside strings", async () => {
  const { parseLenient } = await js("index-data");
  assert.deepEqual(parseLenient('{"a": [1, 2,], "b": "x,}",}'), { a: [1, 2], b: "x,}" });
});

test("dependenciesOf / classifyDep / manifestChanges", async () => {
  const { parseHk } = await js("hk");
  const { dependenciesOf, classifyDep } = await js("deps");
  const { manifestChanges } = await js("diff");
  const a = parseHk("[package]\n-> version => 1.0.0\n[dependencies]\n-> tui => *\n-> old => *\n");
  const b = parseHk("[package]\n-> version => 1.1.0\n[dependencies]\n-> tui => rev v2\n-> x => git https://github.com/u/x v1\n");
  const deps = dependenciesOf(b);
  assert.deepEqual(deps.map((d) => d.name), ["tui", "x"]);
  const libs = [{ name: "tui" }];
  assert.equal(classifyDep(deps[0], libs).kind, "index");
  assert.equal(classifyDep(deps[1], libs).kind, "git");
  const ch = manifestChanges(a, b);
  assert.ok(ch.includes("version 1.0.0 → 1.1.0"));
  assert.ok(ch.some((x) => x.startsWith("~ dependency tui")));
  assert.ok(ch.some((x) => x.startsWith("+ dependency x")));
  assert.ok(ch.includes("− dependency old"));
});

test("diffLines keeps changes with context and collapses the rest", async () => {
  const { diffLines } = await js("diff");
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const b = [...a];
  b[10] = "changed";
  const d = diffLines(a, b, 1);
  assert.deepEqual(d.map((x) => x.t), [" ", "-", "+", " "]);
  assert.ok(d.some((x) => x.t === "-" && x.s === "l10"));
  assert.ok(d.some((x) => x.t === "+" && x.s === "changed"));
  assert.ok(d.length < 10);
  assert.equal(diffLines(new Array(2000).fill("x"), []), null);
});

test("language detection covers .hk .hcs .h# .hl", async () => {
  const { breakdownFromTree, extensionOf } = await js("langcolors");
  assert.equal(extensionOf("src/main.h#"), "h#");
  assert.equal(extensionOf("Bit.hk"), "hk");
  assert.equal(extensionOf("Makefile"), "");
  const b = breakdownFromTree([
    { path: "a.h#", type: "blob", size: 800 },
    { path: "b.hl", type: "blob", size: 100 },
    { path: "c.hcs", type: "blob", size: 50 },
    { path: "Bit.hk", type: "blob", size: 50 },
    { path: "README.md", type: "blob", size: 9999 },
    { path: "src", type: "tree" },
  ]);
  assert.deepEqual(b.map((x) => x.name), ["H#", "Hacker Lang", "HackerScript", "hk"]);
  assert.equal(Math.round(b[0].pct), 80);
});

test("parseHsharp extracts the public API of real H# sources", async () => {
  const { parseHsharp } = await js("apidoc");
  const src = readFileSync(join(here, "..", "..", "src", "semver.h#"), "utf8");
  const items = parseHsharp(src, "src/semver.h#");
  const parse = items.find((i) => i.name === "parse");
  assert.ok(parse, "pub fn parse found");
  assert.equal(parse.kind, "fn");
  assert.equal(parse.sig, "fn parse(tag: string) -> int");
  assert.match(parse.doc, /packed int/);
  assert.ok(!items.some((i) => i.name === "digits"), "private fn is not listed");

  const st = parseHsharp(";; A thing.\npub struct Thing is\n    pub a: int\n    pub b: string ;; note\nend\n", "x.h#");
  assert.equal(st[0].kind, "struct");
  assert.deepEqual(st[0].members, ["pub a: int", "pub b: string"]);
  assert.equal(st[0].doc, "A thing.");
});

test("combineChecksum equals bit's real directory checksum", async (t) => {
  const have = spawnSync("sha256sum", ["--version"]).status === 0;
  if (!have) return t.skip("sha256sum not available");
  const { combineChecksum, sha256Hex } = await js("verify");
  const dir = mkdtempSync(join(tmpdir(), "bitsum-"));
  const files = { "Bit.hk": "[package]\n-> name => x\n", "src/main.h#": "fn main() is end\n", "src/Zed.h#": "z", ".hidden": "h", "a b.txt": "spaces", "lib/ü.h#": "utf8" };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  // the exact pipeline from src/checksum.h#
  const expected = execFileSync(
    "bash",
    ["-c", "cd \"$1\" && find . -type f -not -path './.git/*' -not -path './.bit/*' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1", "_", dir],
    { encoding: "utf8" },
  ).trim();
  const hashes = [];
  for (const [p, c] of Object.entries(files)) hashes.push({ path: p, hex: await sha256Hex(new TextEncoder().encode(c)) });
  assert.equal(await combineChecksum(hashes), expected);
});

/* ------------------------------------------------- directories, brands, syntax (HackerOS languages) */

test("parseGithub understands repositories and sub-directories (libhammer, blue-api)", async () => {
  const { parseGithub } = await js("index-data");
  assert.deepEqual(parseGithub("https://github.com/bit-io/mold"), { owner: "bit-io", repo: "mold" });
  assert.deepEqual(parseGithub("https://github.com/bit-io/mold.git"), { owner: "bit-io", repo: "mold" });
  assert.deepEqual(parseGithub("https://github.com/bit-io/mold/"), { owner: "bit-io", repo: "mold" });
  assert.deepEqual(parseGithub("https://github.com/HackerOS-Linux-System/hammer/tree/main/libhammer"), {
    owner: "HackerOS-Linux-System", repo: "hammer", ref: "main", dir: "libhammer",
  });
  assert.deepEqual(parseGithub("https://github.com/HackerOS-Linux-System/Blue-Environment/tree/main/api/"), {
    owner: "HackerOS-Linux-System", repo: "Blue-Environment", ref: "main", dir: "api",
  });
  assert.deepEqual(parseGithub("https://github.com/o/r/tree/v1.2/libs/a%20b/x"), { owner: "o", repo: "r", ref: "v1.2", dir: "libs/a b/x" });
  assert.deepEqual(parseGithub("https://github.com/o/r/tree/main"), { owner: "o", repo: "r", ref: "main" });
  assert.equal(parseGithub("https://github.com/o/r/tree/main/../x").dir, undefined, "no path traversal");
  assert.equal(parseGithub("https://gitlab.com/o/r"), null);
});

test("repoPath / rawUrl / githubUrl prefix the library directory", async () => {
  const { repoPath, rawUrl, githubUrl } = await js("repodata");
  const r = { owner: "o", repo: "r", ref: "main", dir: "libhammer" };
  assert.equal(repoPath(r, "src/a.h#"), "libhammer/src/a.h#");
  assert.equal(rawUrl(r, "src/a.h#"), "https://raw.githubusercontent.com/o/r/main/libhammer/src/a.h%23");
  assert.equal(githubUrl(r, "tree"), "https://github.com/o/r/tree/main/libhammer");
  assert.equal(githubUrl(r, "blob", "README.md"), "https://github.com/o/r/blob/main/libhammer/README.md");
  const plain = { owner: "o", repo: "r", ref: "HEAD" };
  assert.equal(githubUrl(plain, "tree"), "https://github.com/o/r/tree/HEAD");
  assert.equal(rawUrl(plain, "Bit.hk"), "https://raw.githubusercontent.com/o/r/HEAD/Bit.hk");
});

test("language brands: real icons for H#, HackerScript and Hacker Lang; HackerScript is dark grey", async () => {
  const { brandFor, colorForLanguage, needsOutline } = await js("langcolors");
  assert.equal(brandFor("H#").icon, "https://raw.githubusercontent.com/HackerOS-Linux-System/H-Sharp/main/images/icon.png");
  assert.equal(brandFor("HackerScript").icon, "https://raw.githubusercontent.com/HackerOS-Linux-System/HackerScript/main/images/icon.png");
  assert.equal(brandFor("Hacker Lang").icon, "https://raw.githubusercontent.com/HackerOS-Linux-System/Hacker-Lang/main/images/icon.png");
  assert.equal(brandFor("hk"), null);
  assert.equal(brandFor("Rust"), null);
  const hex = colorForLanguage("HackerScript");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.ok(r === g || Math.abs(r - g) < 8, "grey");
  assert.ok(Math.max(r, g, b) < 0x70, "dark");
  assert.ok(needsOutline("HackerScript"));
});

const kinds = (toks) => toks.filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`);

test("highlighter never loses or invents text (every language)", async () => {
  const { highlight } = await js("highlight");
  const samples = {
    "h#": 'using "2026"\n/// doc\npub fn f(x: int) -> int is\n  // block\n  more \\\\\n  return x ;; c\nend\n@arena\n#[test]\n"unterminated',
    hcs: '!> block\n<!\n!!! d\nget <std:io>\nfun main() [\n  let s = "a\\n" !! c\n  $ ls $\n]\n',
    hl: '#!/usr/bin/env hl\n;;; doc\n# <main/x>\n> ls -la |> @o\n=> E [\n  | a\n]\n: f def\ndone\n_3\n',
    hk: "[a]\n-> k => v ;; c\n! c\n--> p => [a, b]\n",
    rs: 'fn main() { let s = "x"; /* c */ }',
  };
  for (const [ext, src] of Object.entries(samples)) {
    assert.equal(highlight(src, ext, "").map((t) => t.text).join(""), src, ext);
  }
});

test("H# highlighting follows the real lexer (doc, block and legacy comments, attributes, escapes)", async () => {
  const { highlight } = await js("highlight");
  const k = kinds(highlight('/// d\n;; c\n// a\nb \\\\ x\n# old\n#[test]\n@arena\nfn go(n: u8) -> Vec is let s = "a\\n" end', "h#", ""));
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
  assert.ok(highlight("//// not a doc comment\n", "h#", "").every((t) => t.kind !== "doc"));
});

test("HackerScript highlighting: !! !!! !> <! comments, get <std:io>, fun names, native {C++}", async () => {
  const { highlight } = await js("highlight");
  const k = kinds(highlight('!! c\n!!! d\n!> b\nb <!\nget <std:io> import <a::b>\nuse <lang:js>\npub fun add(a: Int) -> Result<Int, Str> [ end a != 1 ]\nnative {C++} [ ]\nlet t = true', "hcs", ""));
  assert.ok(k.includes("com:!! c"));
  assert.ok(k.includes("doc:!!! d"));
  assert.ok(k.includes("com:!> b\nb <!"));
  assert.ok(k.includes("mod:<std:io>"));
  assert.ok(k.includes("mod:<lang:js>"));
  assert.ok(k.includes("fn:add"));
  assert.ok(k.includes("type:Int"));
  assert.ok(k.includes("type:{C++}"));
  assert.ok(k.includes("const:true"));
  assert.ok(k.includes("op:!="), "!= stays an operator, not a comment");
});

test("Hacker Lang highlighting covers the line prefixes of the lexer", async () => {
  const { highlight } = await js("highlight");
  const k = kinds(
    highlight(
      [
        "#!/usr/bin/env hl", ";;; doc", ";; c", "/// d", "// ninja [ninja-build]", "using <gen 2>", "# <main/colors> | x", "<< ./lib.hl", "<* dir",
        "% n: int = 42", "~> hi @n", "$( 1 + @n ) -> @r", "> ls -la /tmp | grep a |> @o", "^> id -u", "/> cat f", "& sleep 1",
        ":: hr 60", ": f def", ":: arena <1024> def", ":* worker def", "-- f", "*-- ch", "*> hsh cmd", "_> run.sh [shell] def",
        "=> NAME = v", "@ x in a b", "?~ @n < 5", "? ok", "?switch @n", "_3", "done",
      ].join("\n"),
      "hl",
      "",
    ),
  );
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

test("hk highlighting: sections, keys, values, comments", async () => {
  const { highlight } = await js("highlight");
  const k = kinds(highlight('[package]\n-> name => "x"\n--> n => 3 ;; c\n! whole line\n', "hk", "Bit.hk"));
  for (const want of ["sec:[package]", "op:->", "key:name", "op:=>", 'str:"x"', "op:-->", "key:n", "num:3", "com:;; c", "com:! whole line"]) {
    assert.ok(k.includes(want), `missing ${want}`);
  }
});

test("fence names map to the right highlighter", async () => {
  const { extForLang, familyFor } = await js("highlight");
  for (const [lang, fam] of [["h#", "hsharp"], ["hsharp", "hsharp"], ["H-Sharp", "hsharp"], ["hackerscript", "hackerscript"], ["hs", "hackerscript"], ["hcs", "hackerscript"], ["Hacker Lang", "hackerlang"], ["hacker-lang", "hackerlang"], ["hl", "hackerlang"], ["hk", "hk"]]) {
    assert.equal(familyFor(extForLang(lang), ""), fam, lang);
  }
});

test("API parser: HackerScript (fun / struct / enum / impl / const / region, !!! !! docs)", async () => {
  const { parseHackerScript } = await js("apidoc");
  const src = [
    "!! Joins two path segments.", "!! Never doubles the slash.", "pub fun path_join(a: Str,", "                   b: Str) -> Str [", "    end a + b", "]",
    "fun _private() [ ]", "", "!!! A point.", "pub struct Point [", "    x: Int,", "    y: Int", "]", "enum Shape [", "    Circle(Float),", "    Empty", "]",
    "impl Point [", "    !! Length.", "    fun length(self) -> Float [", "        end 1.0", "    ]", "]", "const PI: Float = 3.14", "region [", "    fun add(a: Int, b: Int) -> Int", "]",
  ].join("\n");
  const items = parseHackerScript(src, "lib/path.hcs");
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(byName["path_join"].sig, "pub fun path_join(a: Str, b: Str) -> Str");
  assert.match(byName["path_join"].doc, /Never doubles/);
  assert.ok(!byName["_private"], "underscore = private");
  assert.deepEqual(byName["Point"].members, ["x: Int", "y: Int"]);
  assert.equal(byName["Point"].doc, "A point.");
  assert.deepEqual(byName["Shape"].members, ["Circle(Float)", "Empty"]);
  assert.equal(byName["Point.length"].owner, "Point");
  assert.equal(byName["Point.length"].doc, "Length.");
  assert.equal(byName["PI"].sig, "const PI: Float = 3.14");
  assert.equal(byName["add"].kind, "fn", "extern declared in a region");
});

test("API parser: Hacker Lang (functions, arena fns, exports, constants)", async () => {
  const { parseHackerLang } = await js("apidoc");
  const src = [
    ";;; main/str.hl — string helpers", "using <gen 2>", "", "% STR_NEWLINE = \\n", "% _hidden = 1", "% COUNT: int = 3", "",
    "/// Upper-cases @_str.", ": str_to_upper def", "    > echo hi", "done", ":: arena_fn <4096> def", "done", ":* worker def", "done", ": _private def", "done",
    "=> VERSION = 1.0", "=> LIST [", "  | a", "  | b", "]",
  ].join("\n");
  const items = parseHackerLang(src, "main-libs/str.hl");
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(byName["str_to_upper"].sig, ": str_to_upper def");
  assert.equal(byName["str_to_upper"].doc, "Upper-cases @_str.");
  assert.equal(byName["arena_fn"].sig, ":: arena_fn <4096> def");
  assert.equal(byName["worker"].sig, ":* worker def");
  assert.ok(!byName["_private"] && !byName["_hidden"]);
  assert.equal(byName["STR_NEWLINE"].sig, "% STR_NEWLINE = \\n");
  assert.equal(byName["COUNT"].sig, "% COUNT: int = 3");
  assert.equal(byName["VERSION"].sig, "=> VERSION = 1.0");
  assert.deepEqual(byName["LIST"].members, ["a", "b"]);
});

test("API parser: H# methods in impl blocks and /// docs", async () => {
  const { parseHsharp, parseApiFile } = await js("apidoc");
  const items = parseHsharp("/// A stack.\nimpl Stack is\n    /// Push.\n    pub fn push(self, v: int) is\n    end\nend\npub fn top() -> int is\nend\n", "x.h#");
  const push = items.find((i) => i.name === "Stack.push");
  assert.ok(push);
  assert.equal(push.owner, "Stack");
  assert.equal(push.doc, "Push.");
  assert.ok(items.find((i) => i.name === "top"));
  assert.equal(parseApiFile("pub fun a() [ ]", "a.hcs")[0].name, "a");
  assert.equal(parseApiFile(": a def\ndone", "a.hl")[0].name, "a");
});
