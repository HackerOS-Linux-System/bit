const VERSION = "bitio-v3";
const FONTS = "bitio-fonts-v1";

const SHELL = [
  "./",
  "index.html",
  "lib.html",
  "about.html",
  "settings.html",
  "offline.html",
  "styles.css",
  "repository.json",
  "images/icon.png",
  "images/logo.png",
  ...[
    "home", "lib", "about", "settings", "chrome", "theme", "offline", "store", "github", "dom", "langs", "hk",
    "index-data", "repodata", "markdown", "highlight", "langcolors", "langbar", "source", "versions",
    "codeblocks", "overview", "apidoc", "diff", "deps", "verify",
  ].map((n) => `js/${n}.js`),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // one missing file (e.g. repository.json in a local build) must not fail the install
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(request, timeoutMs) {
  return new Promise((resolve) => {
    const nav = request.mode === "navigate";
    const fallback = () =>
      caches
        .match(request, { ignoreSearch: nav })
        .then((hit) => hit || (nav ? caches.match("offline.html") : undefined))
        .then((hit) => hit || Response.error());
    const timer = setTimeout(() => fallback().then(resolve), timeoutMs);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        resolve(res);
      })
      .catch(() => {
        clearTimeout(timer);
        fallback().then(resolve);
      });
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, 4000));
    return;
  }

  // Google Fonts: stale-while-revalidate so the typography survives offline.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONTS).then((cache) =>
        cache.match(request).then((hit) => {
          const net = fetch(request)
            .then((res) => {
              cache.put(request, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || net;
        }),
      ),
    );
  }
  // everything else (api.github.com, raw.githubusercontent.com…) goes straight to the network
});
