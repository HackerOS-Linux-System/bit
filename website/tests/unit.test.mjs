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
