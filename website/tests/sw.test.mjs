import { test, before } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HACKERC = process.env.HACKERC || "hackerc";
let code;

before(() => {
  const out = join(mkdtempSync(join(tmpdir(), "bitio-sw-")), "sw.js");
  const res = spawnSync(HACKERC, ["build", join(here, "..", "cmd", "sw.hcs"), "-o", out], { encoding: "utf8" });
  assert.ok(!/hackerc-self\]|error\[/.test(res.stdout + res.stderr), res.stdout + res.stderr);
  code = readFileSync(out, "utf8");
});

class Cache {
  constructor() { this.map = new Map(); }
  key(req, ignoreSearch) { const u = new URL(typeof req === "string" ? req : req.url, "https://bit.test/"); if (ignoreSearch) u.search = ""; return u.href; }
  async add(u) { const r = await sandbox.fetch({ url: new URL(u, "https://bit.test/").href, method: "GET" }); if (!r.ok) throw new Error("add failed " + u); this.map.set(this.key(u), r); }
  async put(req, res) { this.map.set(this.key(req), res); }
  async match(req, opts = {}) {
    const want = this.key(req, opts.ignoreSearch);
    for (const [k, v] of this.map) if (this.key(k, opts.ignoreSearch) === want) return v;
    return undefined;
  }
}
let sandbox, listeners, caches, fetchImpl, calls;

function boot() {
  listeners = {}; calls = { skip: 0, claim: 0 };
  const store = new Map();
  class CacheStorage {
    constructor() { this.store = store; }
    async open(n) { if (!store.has(n)) store.set(n, new Cache()); return store.get(n); }
    async keys() { return [...store.keys()]; }
    async delete(n) { return store.delete(n); }
    async match(req, opts) { for (const c of store.values()) { const h = await c.match(req, opts); if (h) return h; } return undefined; }
  }
  caches = new CacheStorage();
  const real = setTimeout;
  sandbox = {
    console, URL, Promise, Object, Array, Reflect, String, Number, Boolean, Math, JSON, Error, Symbol,
    caches,
    Response: { error: () => ({ error: true }) },
    fetch: (r) => fetchImpl(r),
    setTimeout: (fn, ms, ...a) => real(fn, Math.min(ms, 40), ...a),
    clearTimeout,
    location: { origin: "https://bit.test" },
    addEventListener: (t, f) => { listeners[t] = f; },
    skipWaiting: async () => { calls.skip++; },
    clients: { claim: async () => { calls.claim++; } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
}
const ok = (tag) => ({ ok: true, tag, clone() { return { ok: true, tag }; } });
const fire = async (type, ev) => {
  const e = { ...ev, waitUntil(p) { this.p = p; }, respondWith(p) { this.p = p; this.responded = true; } };
  listeners[type](e);
  if (e.p) e.result = await e.p;
  return e;
};
const req = (url, extra = {}) => ({ url: "https://bit.test/" + url, method: "GET", mode: "cors", ...extra });
const tick = () => new Promise((r) => setTimeout(r, 5));

test("registers install, activate and fetch listeners synchronously", () => {
  boot();
  assert.deepEqual(Object.keys(listeners).sort(), ["activate", "fetch", "install"]);
});

test("install precaches the shell, survives a missing file and calls skipWaiting", async () => {
  boot();
  fetchImpl = async (r) => (r.url.endsWith("repository.json") ? { ok: false } : ok(r.url));
  await fire("install", {});
  const c = caches.store.get("bitio-v6");
  assert.ok(c.map.size >= 10);
  assert.ok([...c.map.keys()].some((k) => k.endsWith("/lib.js")));
  assert.ok(![...c.map.keys()].some((k) => k.endsWith("repository.json")), "missing file skipped, install did not fail");
  assert.equal(calls.skip, 1);
});

test("activate removes old caches but keeps the current one and the fonts cache", async () => {
  boot();
  for (const n of ["bitio-v5", "bitio-v6", "bitio-fonts-v1", "other"]) await caches.open(n);
  await fire("activate", {});
  assert.deepEqual([...caches.store.keys()].sort(), ["bitio-fonts-v1", "bitio-v6"]);
  assert.equal(calls.claim, 1);
});

test("same-origin GET: network first, response is cached", async () => {
  boot();
  fetchImpl = async (r) => ok("net:" + r.url);
  const e = await fire("fetch", { request: req("about.html") });
  assert.equal(e.result.tag, "net:https://bit.test/about.html");
  await tick();
  assert.ok(caches.store.get("bitio-v6").map.has("https://bit.test/about.html"));
});

test("network failure -> cached copy; navigation ignores the query string; unknown navigation -> offline.html", async () => {
  boot();
  const v6 = await caches.open("bitio-v6");
  v6.map.set("https://bit.test/lib.html", ok("cached-lib"));
  v6.map.set("https://bit.test/offline.html", ok("offline-page"));
  fetchImpl = async () => { throw new Error("offline"); };
  assert.equal((await fire("fetch", { request: req("lib.html?name=mold", { mode: "navigate" }) })).result.tag, "cached-lib");
  assert.equal((await fire("fetch", { request: req("nope.html", { mode: "navigate" }) })).result.tag, "offline-page");
  assert.deepEqual((await fire("fetch", { request: req("nope.js") })).result, { error: true });
});

test("a slow network (> timeout) falls back to the cache", async () => {
  boot();
  const v6 = await caches.open("bitio-v6");
  v6.map.set("https://bit.test/home.js", ok("cached-js"));
  fetchImpl = () => new Promise(() => {});
  assert.equal((await fire("fetch", { request: req("home.js") })).result.tag, "cached-js");
});

test("non-GET and third-party requests are not intercepted", async () => {
  boot();
  fetchImpl = async () => ok("x");
  assert.equal((await fire("fetch", { request: req("a", { method: "POST" }) })).responded, undefined);
  assert.equal((await fire("fetch", { request: { url: "https://api.github.com/repos/o/r", method: "GET" } })).responded, undefined);
});

test("Google Fonts: stale-while-revalidate, network fallback and error when neither exists", async () => {
  boot();
  const font = { url: "https://fonts.gstatic.com/s/x.woff2", method: "GET" };
  fetchImpl = async () => ok("fresh");
  assert.equal((await fire("fetch", { request: font })).result.tag, "fresh");
  await tick();
  fetchImpl = async () => ok("newer");
  assert.equal((await fire("fetch", { request: font })).result.tag, "fresh", "serves the stale copy immediately");
  boot();
  fetchImpl = async () => { throw new Error("offline"); };
  assert.deepEqual((await fire("fetch", { request: font })).result, { error: true });
});
