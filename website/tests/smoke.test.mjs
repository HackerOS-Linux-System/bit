import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const built = existsSync(join(dist, "lib.html"));
const BASE = "https://bit.test";

const README = `# Mold

<p align="center"><img src="docs/logo.png" width="120" alt="logo"><script>window.PWNED=1</script></p>

[![CI](https://img.shields.io/badge/ci-passing-green.svg)](https://github.com/bit-io/mold/actions) **bold** _it_ ~~gone~~ \`code\`

## Usage

| Name | Value |
|------|:-----:|
| a | 1 |

- item one
  - nested
- [ ] todo
- [x] done

## Example

\`\`\`h#
;; hello
fn main() is return 1 end
\`\`\`

### Details

<details><summary>More</summary>

Hidden **md** [link](#usage) [bad](javascript:alert(1))

</details>
`;
const HK = "[package]\n-> name => mold\n-> version => 1.2.0\n-> license => MIT\n[edition]\n-> toolchain => 0.9\n[dependencies]\n-> tui => *\n-> ghost => *\n";
const TUI_HK = "[package]\n-> name => tui\n[dependencies]\n-> mold => rev v1\n";
const OLD_HK = "[package]\n-> name => mold\n-> version => 1.1.0\n[dependencies]\n-> tui => *\n-> gone => *\n";
const FILES = {
  "Bit.hk": HK,
  "README.md": README,
  "src/main.h#": ";; Entry point.\npub fn main(args: [string]) -> int is\n    let x = 42\n    return x\nend\n\n;; A `Thing`.\npub struct Thing is\n    pub a: int\nend\n",
  "src/ui.h#": ";; Draw it.\n;;\n;; Second paragraph.\npub fn draw(w: int,\n            h: int) -> bool is\n    return true\nend\n\nfn hidden() is end\n",
  "scripts/build.hl": "// build\n^> echo hi\n",
  "scripts/run.hcs": "// run\n",
  "examples/hello.h#": 'using "2026"\nfn main() is print("hi") end\n',
  "main.c": "int main(){return 0;}\n",
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const CHECKSUM = "sha256:" + sha(Object.keys(FILES).map((p) => "./" + p).sort().map((n) => `${sha(FILES[n.slice(2)])}  ${n}\n`).join(""));
const TREE = { tree: Object.entries(FILES).map(([path, c]) => ({ path, type: "blob", size: Buffer.byteLength(c), mode: "100644" })), truncated: false };
const REL = [
  { tag_name: "v1.2.0", name: "Big release", published_at: "2026-09-01T10:00:00Z", prerelease: false, draft: false, html_url: "https://github.com/bit-io/mold/releases/tag/v1.2.0", body: "Notes **here**", assets: [{ name: "mold.bit", size: 2048, download_count: 3, browser_download_url: "https://github.com/bit-io/mold/releases/download/v1.2.0/mold.bit" }] },
  { tag_name: "v1.1.0", name: "", published_at: "2026-08-01T10:00:00Z", prerelease: false, draft: false, html_url: "https://github.com/bit-io/mold/releases/tag/v1.1.0", body: "", assets: [] },
];
const INDEX = {
  updated_at: "2026-11-01",
  libraries: [
    { name: "mold", target: "https://github.com/bit-io/mold", description: "A thing", tags: ["tui", "cli"], lang: "hsharp", author: "A", rev: "v1.2.0", checksum: CHECKSUM },
    { name: "tui", target: "https://github.com/bit-io/tui", description: "Terminal UI", tags: ["tui"], lang: "hackerscript" },
    ...["a", "b", "c", "d", "e"].map((n) => ({ name: "lib-" + n, target: "https://github.com/bit-io/" + n, description: "x " + n, tags: [], lang: "hackerlang" })),
  ],
};

const seen = { api: [], raw: [] };
function fakeFetch(url, init = {}) {
  const u = String(url);
  const h = init.headers || {};
  const res = (status, body, extra = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (extra[k.toLowerCase()] ?? null), entries: () => Object.entries(extra) },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => { const b = Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  });
  const rl = { "x-ratelimit-remaining": "4990", "x-ratelimit-limit": "5000", "x-ratelimit-reset": "1999999999" };
  if (u.endsWith("repository.json")) return Promise.resolve(res(200, INDEX));
  if (u.includes("api.github.com")) {
    seen.api.push(h.Authorization ?? null);
    if (u.includes("/rate_limit")) return Promise.resolve(res(200, { resources: { core: { remaining: 4990, limit: 5000, reset: 1999999999 } } }, rl));
    if (u.includes("/git/trees/")) return Promise.resolve(res(200, TREE, rl));
    if (u.includes("/releases")) return Promise.resolve(res(200, REL, rl));
    if (u.includes("/commits/")) return Promise.resolve(res(200, { sha: "a".repeat(40), commit: { message: "Release 1.2.0\n\nbody", committer: { date: "2026-09-01T10:00:00Z" } } }, rl));
    if (u.endsWith("/repos/bit-io/mold")) return Promise.resolve(res(200, { stargazers_count: 1234, forks_count: 56, open_issues_count: 7, license: { spdx_id: "MIT" }, pushed_at: new Date().toISOString(), default_branch: "main", topics: ["tui"], homepage: "" }, rl));
    return Promise.resolve(res(404, {}, rl));
  }
  if (u.includes("raw.githubusercontent.com")) {
    seen.raw.push(h.Authorization ?? null);
    const path = decodeURIComponent(u.split("/").slice(6).join("/"));
    if (u.includes("/bit-io/tui/") && path === "Bit.hk") return Promise.resolve(res(200, TUI_HK));
    if (u.includes("/bit-io/mold/")) {
      if (u.includes("/v1.1.0/") && path === "Bit.hk") return Promise.resolve(res(200, OLD_HK));
      if (path in FILES) return Promise.resolve(res(200, FILES[path]));
    }
    return Promise.resolve(res(404, "nf"));
  }
  return Promise.reject(new Error("no network: " + u));
}

function open(page, search = "", { token = "", blockStorage = false } = {}) {
  const js = page === "index" ? "home" : page;
  const html = readFileSync(join(dist, `${page}.html`), "utf8");
  const errors = [];
  const dom = new JSDOM(html, { url: `${BASE}/${page}.html${search}`, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  w.matchMedia = () => ({ matches: false });
  w.fetch = fakeFetch;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  Object.defineProperty(w, "crypto", { value: globalThis.crypto });
  w.Element.prototype.scrollIntoView = () => {};
  if (blockStorage) {
    Object.defineProperty(w, "localStorage", { get() { throw new w.DOMException("denied", "SecurityError"); } });
    w.history.replaceState = () => { throw new w.DOMException("origin null", "SecurityError"); };
  }
  if (token) w.localStorage.setItem("bitio:gh-token", token);
  try { w.eval(readFileSync(join(dist, `${js}.js`), "utf8")); } catch (e) { errors.push(String(e)); }
  return { w, d: w.document, errors };
}
const until = async (fn, what, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for: " + what);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const q = (d, s) => d.querySelector(s);
const qa = (d, s) => [...d.querySelectorAll(s)];
const click = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
const goTab = async (w, id) => { w.location.hash = "#" + id; w.dispatchEvent(new w.HashChangeEvent("hashchange")); };

before(() => assert.ok(built, "run `bash scripts/build.sh` first (dist/ is missing)"));

test("static output: every page loads its own script; 404/offline/sw exist", () => {
  for (const [p, js] of [["index", "home"], ["lib", "lib"], ["about", "about"], ["settings", "settings"]]) {
    assert.match(readFileSync(join(dist, `${p}.html`), "utf8"), new RegExp(`src="${js}\\.js"`), p);
    assert.ok(existsSync(join(dist, `${js}.js`)), `${js}.js`);
  }
  for (const f of ["404.html", "offline.html", "sw.js", "repository.json", "robots.txt", "sitemap.xml"]) assert.ok(existsSync(join(dist, f)), f);
});

test("404 and offline pages render from their inlined script (no extra files needed)", async () => {
  for (const [file, heading, action] of [["404.html", "404", /Back to bit\.io/], ["offline.html", "No internet connection", /Go to the index/]]) {
    const html = readFileSync(join(dist, file), "utf8");
    assert.ok(!/src="[^"]*\.js"/.test(html), `${file} must not depend on a separate script`);
    const dom = new JSDOM(html, { url: `${BASE}/some/deep/path/${file}`, runScripts: "dangerously" });
    await until(() => dom.window.document.querySelector("h1"), `${file} h1`);
    assert.equal(dom.window.document.querySelector("h1").textContent, heading);
    assert.match(dom.window.document.body.textContent, action);
  }
});

test("index lists libraries, filters by language and search", async () => {
  const { w, d, errors } = open("index");
  await until(() => qa(d, ".card").length > 5, "cards");
  assert.equal(q(d, "#stat-libs").textContent, "7");
  assert.match(q(d, "#count").textContent, /7 of 7/);
  const search = q(d, "#search");
  search.value = "terminal"; search.dispatchEvent(new w.Event("input"));
  assert.equal(qa(d, ".card").length, 1);
  search.value = ""; search.dispatchEvent(new w.Event("input"));
  click(w, qa(d, ".chip").find((c) => c.textContent === "HackerScript"));
  assert.equal(qa(d, ".card").length, 1);
  assert.deepEqual(errors, []);
});

test("blocked localStorage / replaceState (file://) must not break the page", async () => {
  const { w, d, errors } = open("index", "?q=a", { blockStorage: true });
  await until(() => qa(d, ".card").length > 0, "cards render without storage");
  assert.ok(q(d, "[data-get-app]"), "chrome finished initialising (Get the app button)");
  assert.match(q(d, "#count").textContent, /of 7 libraries/);
  const s = open("settings", "", { blockStorage: true });
  await until(() => q(s.d, "#token-save"), "settings without storage");
  const l = open("lib", "?name=mold", { blockStorage: true });
  await until(() => q(l.d, ".markdown-body h1"), "library page without storage");
  assert.deepEqual([...errors, ...s.errors, ...l.errors], []);
});

test("one shared stylesheet: no page-specific CSS leaks (404/offline/index)", () => {
  for (const f of ["index.html", "lib.html", "about.html", "settings.html", "404.html", "offline.html"]) {
    const html = readFileSync(join(dist, f), "utf8");
    assert.ok(!/font-size: 4rem; margin: 0; background: linear-gradient/.test(html) && !/min-height: 100vh; background: #0e0e13/.test(html), `${f}: stray 404/offline CSS`);
    assert.ok(/Inter/.test(html), `${f}: site stylesheet present`);
  }
});

test("about and settings render the shell", async () => {
  const a = open("about");
  await until(() => q(a.d, "h1"), "about h1");
  assert.ok(qa(a.d, ".snippet .copy").length >= 3);
  assert.ok(q(a.d, "[data-get-app]"));
  const s = open("settings");
  await until(() => q(s.d, "#token-save"), "settings");
  s.d.getElementById("token-input").value = "ghp_" + "a".repeat(36);
  click(s.w, s.d.getElementById("token-save"));
  assert.equal(s.w.localStorage.getItem("bitio:gh-token"), "ghp_" + "a".repeat(36));
  await until(() => /requests left/.test(q(s.d, "#token-rate").textContent), "rate limit text");
  assert.deepEqual([...a.errors, ...s.errors], []);
});

test("library page: README, stats, pin, checksum, API, source, versions", async () => {
  seen.api.length = 0; seen.raw.length = 0;
  const token = "ghp_" + "b".repeat(36);
  const { w, d, errors } = open("lib", "?name=mold", { token });
  await until(() => q(d, ".markdown-body h1"), "README h1");
  await until(() => qa(d, ".lang-legend-item").length > 0, "language bar");
  assert.equal(w.PWNED, undefined);
  assert.equal(qa(d, ".markdown-body script").length, 0, "scripts stripped");
  assert.equal(qa(d, ".markdown-body table tr").length, 2);
  assert.equal(qa(d, ".markdown-body input[type=checkbox]").length, 2);
  assert.equal(qa(d, ".markdown-body a[href^='javascript']").length, 0);
  assert.ok(qa(d, ".toc a").length >= 3, "table of contents");
  assert.ok(qa(d, ".markdown-body pre .tok-kw").length > 0, "README code highlighted");
  assert.match(q(d, ".lang-legend").textContent, /H#/);
  await until(() => q(d, ".stats-row"), "stats");
  assert.match(q(d, ".stats-row").textContent, /1\.2k/);
  assert.match(q(d, ".stats-row").textContent, /56/);
  await until(() => /Resolves/.test(d.body.textContent), "pinned rev resolves");
  await until(() => /not in index/.test(d.body.textContent), "ghost dependency flagged");
  assert.match(q(d, ".notes").textContent, /Needs the H# toolchain 0\.9/);
  await until(() => q(d, ".side-card .deps a[href*='name=tui']") && /Used by/.test(d.body.textContent), "used by tui", 15000);
  click(w, qa(d, "button").find((b) => b.textContent === "Verify checksum"));
  await until(() => /Matches/.test(d.body.textContent), "checksum matches", 15000);
  await until(() => qa(d, ".example").length === 1, "examples");

  await goTab(w, "api");
  await until(() => qa(d, ".api-item").length === 3, "3 api items (private fn hidden)");
  assert.ok(qa(d, ".api-sig").map((e) => e.textContent).includes("fn draw(w: int, h: int) -> bool"));
  assert.match(qa(d, ".api-doc")[2].textContent, /Second paragraph/);
  const f = q(d, ".api-tools input"); f.value = "draw"; f.dispatchEvent(new w.Event("input"));
  assert.equal(qa(d, ".api-item").filter((a) => !a.hidden).length, 1, "API filter");

  await goTab(w, "source");
  await until(() => qa(d, ".src-line").length > 0, "source lines");
  const si = q(d, ".src-search input"); si.value = "return";
  q(d, ".src-search").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await until(() => qa(d, ".src-result-line").length >= 3, "code search");
  const first = q(d, ".src-result-line");
  w.location.hash = first.getAttribute("href"); w.dispatchEvent(new w.HashChangeEvent("hashchange"));
  await until(() => qa(d, ".src-line.is-hl").length === 1, "line highlighted");

  await goTab(w, "versions");
  await until(() => qa(d, ".ver").length === 2, "2 versions");
  assert.equal(qa(d, "a").filter((a) => /Compare with v1\.1\.0/.test(a.textContent)).length, 1);
  const sum = q(d, ".ver-diff summary"); sum.parentElement.open = true; sum.parentElement.dispatchEvent(new w.Event("toggle"));
  await until(() => q(d, ".diff"), "diff");
  assert.ok(qa(d, ".diff-add").length > 0);

  assert.ok(seen.api.length > 0 && seen.api.every((a) => a === "Bearer " + token), "token only sent to api.github.com");
  assert.ok(seen.raw.every((a) => a === null), "token never sent to raw.githubusercontent.com");
  assert.deepEqual(errors, []);
});

test("library page without a match / without a name", async () => {
  const a = open("lib", "?name=nope");
  await until(() => /not in the index/.test(a.d.body.textContent), "unknown library");
  const b = open("lib");
  await until(() => /No library selected/.test(b.d.body.textContent), "no name");
});
