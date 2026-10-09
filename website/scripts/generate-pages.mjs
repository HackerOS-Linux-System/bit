import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");

function parseLenient(text) {
  // the hand-edited index has had trailing commas
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const doc = parseLenient(readFileSync(join(root, "..", "index", "repository.json"), "utf8"));
const libs = (Array.isArray(doc) ? doc : doc.libraries ?? []).filter((l) => l && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(l.name ?? ""));

mkdirSync(join(dist, "lib"), { recursive: true });
for (const l of libs) {
  const title = `${l.name} — bit.io`;
  const desc = l.description || `${l.name} is a library in the bit.io index for H#, Hacker Lang and HackerScript.`;
  const target = `../lib.html?name=${encodeURIComponent(l.name)}`;
  const url = site ? `${site}/lib/${encodeURIComponent(l.name)}.html` : "";
  const image = site ? `${site}/images/logo.png` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
${url ? `<link rel="canonical" href="${esc(url)}" />\n<meta property="og:url" content="${esc(url)}" />` : ""}
<meta property="og:type" content="website" />
<meta property="og:site_name" content="bit.io" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
${image ? `<meta property="og:image" content="${esc(image)}" />\n<meta name="twitter:image" content="${esc(image)}" />` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta http-equiv="refresh" content="0; url=${esc(target)}" />
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body><p><a href="${esc(target)}">${esc(l.name)}</a> — ${esc(desc)}</p></body>
</html>
`;
  writeFileSync(join(dist, "lib", `${l.name}.html`), html);
}

if (site) {
  const pages = ["index.html", "about.html", "settings.html", ...libs.map((l) => `lib/${encodeURIComponent(l.name)}.html`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${esc(`${site}/${p}`)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
  writeFileSync(join(dist, "sitemap.xml"), xml);
  const robots = join(dist, "robots.txt");
  if (existsSync(robots)) appendFileSync(robots, `Sitemap: ${site}/sitemap.xml\n`);
}
console.log(`generated ${libs.length} library pages${site ? " + sitemap.xml" : " (set SITE_URL for absolute URLs and a sitemap)"}`);
