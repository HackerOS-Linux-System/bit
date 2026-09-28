import { $, clear, copyButton, h, safeUrl } from "./dom.js";
import { loadIndex, parseGithub } from "./index-data.js";
import { langInfo, normalizeLang } from "./langs.js";
import { hkList, parseHk } from "./hk.js";
import type { HkDoc, LibEntry } from "./types.js";
import { initTheme } from "./theme.js";

const MANIFESTS = ["Bit.hk", "bit.hk", "Bytes.hk", "Virus.hk"];

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

async function fetchManifest(owner: string, repo: string, ref: string): Promise<{ file: string; doc: HkDoc } | null> {
  for (const f of MANIFESTS) {
    const t = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${f}`);
    if (t) return { file: f, doc: parseHk(t) };
  }
  return null;
}

function row(k: string, v: string | HTMLElement): HTMLElement {
  return h("div", { class: "kv" }, h("dt", {}, k), h("dd", {}, v));
}

function renderMeta(e: LibEntry, m: { file: string; doc: HkDoc } | null): HTMLElement {
  const pkg = m?.doc["package"] ?? m?.doc["project"] ?? {};
  const info = langInfo(e.lang !== "any" ? e.lang : normalizeLang(pkg["lang"]));
  const dl = h("dl", { class: "meta" });
  dl.append(row("Language", info.label));
  if (pkg["version"]) dl.append(row("Version", pkg["version"]));
  if (pkg["license"]) dl.append(row("License", pkg["license"]));
  if (e.author) dl.append(row("Author", e.author));
  if (e.rev) dl.append(row("Pinned rev", e.rev));
  if (e.checksum) dl.append(row("Pinned checksum", e.checksum));
  const out = m?.doc["lib"]?.["output"];
  dl.append(row("Library output", `${out || "hlib"} — statically linked`));
  if (e.target) dl.append(row("Repository", h("a", { href: safeUrl(e.target), rel: "noopener", target: "_blank" }, e.target)));
  return dl;
}

function renderDeps(doc: HkDoc | undefined): HTMLElement | null {
  const deps = doc?.["dependencies"];
  if (!deps) return null;
  const names = Object.keys(deps).filter((k) => !k.includes("."));
  if (names.length === 0) return null;
  return h(
    "section",
    { class: "block" },
    h("h2", {}, "Dependencies"),
    h(
      "ul",
      { class: "deps" },
      ...names.map((n) =>
        h("li", {}, h("a", { href: `lib.html?name=${encodeURIComponent(n)}` }, n), h("span", { class: "muted" }, `  ${deps[n] ?? ""}`)),
      ),
    ),
  );
}

function renderCommands(doc: HkDoc | undefined): HTMLElement | null {
  const cmds = doc?.["commands"];
  if (!cmds) return null;
  const names = Object.keys(cmds).filter((k) => !k.includes("."));
  if (names.length === 0) return null;
  return h(
    "section",
    { class: "block" },
    h("h2", {}, "Custom commands"),
    h(
      "ul",
      { class: "deps" },
      ...names.map((n) => h("li", {}, h("code", {}, `bit ${n}`), h("span", { class: "muted" }, `  ${cmds[`${n}.description`] ?? ""}`))),
    ),
  );
}

async function main(): Promise<void> {
  initTheme();
  const root = $("detail");
  const name = new URLSearchParams(location.search).get("name") ?? "";
  if (!name) {
    root.append(h("p", { class: "empty" }, "No library selected. "), h("a", { href: "index.html" }, "Browse the index"));
    return;
  }
  document.title = `${name} — bit.io`;

  let entry: LibEntry | undefined;
  try {
    entry = (await loadIndex()).libraries.find((l) => l.name.toLowerCase() === name.toLowerCase());
  } catch (e) {
    clear(root);
    root.append(h("p", { class: "empty" }, `Could not load the index (${e instanceof Error ? e.message : "error"}).`));
    return;
  }
  if (!entry) {
    clear(root);
    root.append(h("p", { class: "empty" }, `"${name}" is not in the index.`), h("a", { href: "index.html" }, "Browse the index"));
    return;
  }

  const gh = parseGithub(entry.target);
  const manifestPromise = gh ? fetchManifest(gh.owner, gh.repo, entry.rev || "HEAD") : Promise.resolve(null);
  const readmePromise = gh
    ? fetchText(`https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${entry.rev || "HEAD"}/README.md`)
    : Promise.resolve(null);

  clear(root);
  const install = `bit install ${entry.name}`;
  const add = `bit add ${entry.name}`;
  root.append(
    h("h1", {}, entry.name),
    h("p", { class: "lead" }, entry.description || ""),
    h("div", { class: "tags" }, ...entry.tags.map((t) => h("a", { class: "tag", href: `index.html?tag=${encodeURIComponent(t)}` }, t))),
    h(
      "section",
      { class: "block" },
      h("h2", {}, "Install"),
      h("div", { class: "cmd" }, h("code", {}, install), copyButton(install)),
      h("div", { class: "cmd" }, h("code", {}, add), copyButton(add), h("span", { class: "muted" }, " adds it to [dependencies] in Bit.hk")),
    ),
  );

  const meta = h("div", { id: "meta" }, renderMeta(entry, null));
  root.append(h("section", { class: "block" }, h("h2", {}, "Details"), meta));

  const manifest = await manifestPromise;
  if (manifest) {
    clear(meta);
    meta.append(renderMeta(entry, manifest));
    const deps = renderDeps(manifest.doc);
    const cmds = renderCommands(manifest.doc);
    if (deps) root.append(deps);
    if (cmds) root.append(cmds);
    const list = hkList(manifest.doc["package"]?.["authors"]);
    if (list.length > 0) meta.append(row("Authors", list.join(", ")));
    root.append(h("p", { class: "muted" }, `Read from ${manifest.file} in the repository.`));
  }

  const readme = await readmePromise;
  if (readme) {
    root.append(h("section", { class: "block" }, h("h2", {}, "README"), h("pre", { class: "readme" }, readme.slice(0, 20000))));
  }
}

void main();
