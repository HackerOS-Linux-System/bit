import { clear, copyButton, h, safeUrl } from "./dom.js";
import { buildToc, decorateCode } from "./codeblocks.js";
import { classifyDep, compatNotes, dependenciesOf, scanUsedBy } from "./deps.js";
import { hkList } from "./hk.js";
import { renderMarkdown } from "./markdown.js";
import { langInfo, normalizeLang } from "./langs.js";
import { highlight } from "./highlight.js";
import { extensionOf } from "./langcolors.js";
import { loadFile, loadManifest, loadReadme, loadRepoMeta, loadTree, rememberSha, resolveRev, seenSha, type Repo, type RepoMeta } from "./repodata.js";
import { GithubError } from "./github.js";
import { formatAge } from "./store.js";
import { verifyChecksum, VerifyError, untag } from "./verify.js";
import { sourceHash } from "./source.js";
import type { HkDoc, LibEntry } from "./types.js";

export interface OverviewCtx {
  entry: LibEntry;
  repo: Repo | null;
  libs: LibEntry[];
}

const side = (title: string, ...kids: Array<HTMLElement | null>): HTMLElement =>
  h("section", { class: "side-card" }, h("h3", {}, title), ...kids);

function kv(k: string, v: string | HTMLElement): HTMLElement {
  return h("div", { class: "kv" }, h("dt", {}, k), h("dd", {}, v));
}

function renderMeta(e: LibEntry, m: { file: string; doc: HkDoc } | null, ref: string, meta: RepoMeta | null): HTMLElement {
  const pkg = m?.doc["package"] ?? m?.doc["project"] ?? {};
  const info = langInfo(e.lang !== "any" ? e.lang : normalizeLang(pkg["lang"]));
  const dl = h("dl", { class: "meta" });
  dl.append(kv("Language", info.label));
  if (pkg["version"]) dl.append(kv("Version", pkg["version"]));
  const license = pkg["license"] || meta?.license;
  if (license) dl.append(kv("License", license));
  if (e.author) dl.append(kv("Author", e.author));
  const authors = hkList(pkg["authors"]);
  if (authors.length > 0) dl.append(kv("Authors", authors.join(", ")));
  if (ref !== "HEAD" && ref !== e.rev) dl.append(kv("Viewing", ref));
  dl.append(kv("Library output", `${m?.doc["lib"]?.["output"] || "hlib"} — static`));
  if (e.target) dl.append(kv("Repository", h("a", { href: safeUrl(e.target), rel: "noopener", target: "_blank" }, e.target.replace(/^https:\/\//, ""))));
  if (meta?.homepage && /^https?:\/\//.test(meta.homepage)) dl.append(kv("Homepage", h("a", { href: safeUrl(meta.homepage), rel: "noopener", target: "_blank" }, meta.homepage.replace(/^https?:\/\//, ""))));
  return dl;
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
}

function activity(pushedAt: string): { label: string; cls: string } | null {
  const t = Date.parse(pushedAt);
  if (Number.isNaN(t)) return null;
  const days = (Date.now() - t) / 86_400_000;
  if (days < 90) return { label: "Active", cls: "is-ok" };
  if (days < 365) return { label: "Quiet", cls: "is-warn" };
  return { label: "Inactive", cls: "is-err" };
}

export function mountOverview(panel: HTMLElement, ctx: OverviewCtx): { reload: () => void } {
  const { entry, repo, libs } = ctx;
  const ref = repo?.ref ?? "HEAD";
  const install = `bit install ${entry.name}`;
  const add = `bit add ${entry.name}`;

  const main = h("div", { class: "ov-main" });
  const aside = h("div", { class: "ov-side" });
  panel.append(h("div", { class: "ov-grid" }, main, aside));

  /* ---- sidebar: install ---- */
  aside.append(
    side(
      "Install",
      h("div", { class: "cmd" }, h("code", {}, install), copyButton(install)),
      h("div", { class: "cmd" }, h("code", {}, add), copyButton(add)),
      h("p", { class: "muted small" }, "add also writes it to [dependencies] in Bit.hk."),
    ),
  );

  /* ---- sidebar: GitHub stats ---- */
  const statsBox = h("div", {}, h("p", { class: "muted small" }, repo ? "Loading…" : "Only for GitHub-hosted libraries."));
  const metaBox = h("div", {});
  aside.append(side("Repository", statsBox), side("Details", metaBox));
  let ghMeta: RepoMeta | null = null;
  let manifest: { file: string; doc: HkDoc } | null = null;
  const redrawMeta = (): void => metaBox.replaceChildren(renderMeta(entry, manifest, ref, ghMeta));
  redrawMeta();

  /* ---- sidebar: pin / checksum ---- */
  const pinBox = h("div", {});
  aside.append(side("Pinned revision", pinBox));
  /* ---- sidebar: compat, deps, used by, commands, badge ---- */
  const compatCard = h("div", {});
  const depsCard = h("div", {});
  const usedCard = h("div", {});
  const cmdsCard = h("div", {});
  aside.append(side("Compatibility", compatCard), side("Dependencies", depsCard), side("Used by", usedCard), cmdsCard, badgeCard(entry));

  /* ---- main: examples + README ---- */
  const examplesBox = h("section", { class: "block", hidden: "" });
  const readmeBox = h("section", { class: "block", id: "readme-block" });
  main.append(readmeBox, examplesBox);

  let usedStop = false;

  const loadStats = async (): Promise<void> => {
    if (!repo) return;
    try {
      const res = await loadRepoMeta(repo);
      const m = res.value;
      if (!m) {
        statsBox.replaceChildren(h("p", { class: "muted small" }, "Repository not found on GitHub."));
        return;
      }
      ghMeta = m;
      const act = activity(m.pushedAt);
      const stat = (label: string, value: string): HTMLElement => h("div", { class: "stat" }, h("b", {}, value), h("span", {}, label));
      statsBox.replaceChildren(
        h("div", { class: "stats-row" }, stat("stars", compact(m.stars)), stat("forks", compact(m.forks)), stat("open issues", compact(m.issues))),
        h(
          "p",
          { class: "muted small" },
          act ? h("span", { class: `pill ${act.cls}` }, act.label) : "",
          m.pushedAt ? ` last push ${new Date(m.pushedAt).toLocaleDateString()}` : "",
          m.archived ? h("span", { class: "pill is-err" }, "Archived") : "",
          res.stale ? ` · saved copy (${formatAge(res.ageMs)})` : "",
        ),
        ...(m.topics.length ? [h("div", { class: "tags" }, ...m.topics.slice(0, 8).map((t) => h("span", { class: "tag" }, t)))] : []),
      );
      redrawMeta();
    } catch (e) {
      statsBox.replaceChildren(h("p", { class: "muted small" }, e instanceof GithubError ? e.message : "Couldn't load repository stats (offline?)."));
    }
  };

  const loadPin = async (): Promise<void> => {
    pinBox.replaceChildren();
    if (!repo) {
      pinBox.append(h("p", { class: "muted small" }, "Only for GitHub-hosted libraries."));
      return;
    }
    if (!entry.rev) {
      pinBox.append(
        h("p", { class: "muted small" }, h("span", { class: "pill is-warn" }, "Not pinned"), " The index doesn't pin a tag or commit, so `bit install` takes the newest default-branch head. New entries must be pinned."),
      );
      return;
    }
    const pinned: Repo = { ...repo, ref: entry.rev };
    const line = h("p", { class: "small" }, h("code", {}, entry.rev), " ", h("span", { class: "muted" }, "checking…"));
    pinBox.append(line);
    try {
      const res = await resolveRev(pinned);
      if (!res.value) {
        line.replaceChildren(h("code", {}, entry.rev), " ", h("span", { class: "pill is-err" }, "Not found"), h("span", { class: "muted" }, " this tag/commit doesn't exist on GitHub — installs will fail."));
      } else {
        const before = seenSha(pinned);
        if (!res.stale) rememberSha(pinned, res.value.sha);
        line.replaceChildren(
          h("code", {}, entry.rev),
          " → ",
          h("a", { href: `https://github.com/${repo.owner}/${repo.repo}/commit/${res.value.sha}`, target: "_blank", rel: "noopener" }, h("code", {}, res.value.sha.slice(0, 7))),
          " ",
          h("span", { class: "pill is-ok" }, "Resolves"),
          res.value.date ? h("span", { class: "muted" }, ` ${new Date(res.value.date).toLocaleDateString()}`) : "",
        );
        if (before && before !== res.value.sha) {
          pinBox.append(h("p", { class: "small" }, h("span", { class: "pill is-err" }, "Moved"), ` This ref used to point to ${before.slice(0, 7)} when you last looked — the pinned code changed.`));
        }
      }
    } catch (e) {
      line.replaceChildren(h("code", {}, entry.rev), " ", h("span", { class: "muted" }, e instanceof GithubError ? e.message : "couldn't check (offline?)"));
    }

    if (entry.checksum) {
      const out = h("p", { class: "small", "aria-live": "polite" });
      const btn = h("button", { class: "btn", type: "button" }, "Verify checksum");
      pinBox.append(h("p", { class: "small" }, "checksum ", h("code", {}, `${entry.checksum.slice(0, 18)}…`), " ", copyButton(entry.checksum, "Copy")), btn, out);
      btn.addEventListener("click", () => {
        btn.disabled = true;
        out.className = "small muted";
        out.textContent = "Downloading files…";
        verifyChecksum(pinned, entry.checksum ?? "", (d, t) => (out.textContent = `Hashing files… ${d}/${t}`))
          .then((r) => {
            out.className = `small ${r.ok ? "is-ok-text" : "is-err-text"}`;
            out.textContent = r.ok
              ? `✓ Matches — the ${r.files} files of ${entry.rev} hash to the checksum in the index.`
              : `✗ Different. Index: ${untag(entry.checksum ?? "").slice(0, 12)}… · computed: ${r.actual.slice(0, 12)}… (${r.files} files). The code at this rev doesn't match what the index recorded.`;
          })
          .catch((e) => {
            out.className = "small is-warn-text";
            out.textContent = e instanceof VerifyError ? e.message : e instanceof GithubError ? e.message : "Couldn't verify (offline?).";
          })
          .finally(() => (btn.disabled = false));
      });
    } else {
      pinBox.append(h("p", { class: "muted small" }, "No checksum recorded in the index."));
    }
  };

  const fillManifest = (m: { file: string; doc: HkDoc }, stale: boolean, age: number | null): void => {
    manifest = m;
    redrawMeta();
    clear(compatCard);
    const notes = compatNotes(entry, m.doc, libs);
    compatCard.append(
      notes.length
        ? h("ul", { class: "notes" }, ...notes.map((n) => h("li", { class: n.level === "warn" ? "is-warn-text" : "" }, n.level === "warn" ? "⚠ " : "✓ ", n.text.replace(/`/g, ""))))
        : h("p", { class: "muted small" }, "Nothing special declared."),
      h("p", { class: "muted small" }, `Read from ${m.file}${stale ? ` · saved copy (${formatAge(age)})` : ""}.`),
    );

    clear(depsCard);
    const deps = dependenciesOf(m.doc);
    if (deps.length === 0) depsCard.append(h("p", { class: "muted small" }, "No dependencies."));
    else {
      depsCard.append(
        h(
          "ul",
          { class: "deps" },
          ...deps.map((d) => {
            const c = classifyDep(d, libs);
            return h(
              "li",
              {},
              c.kind === "index" ? h("a", { href: `lib.html?name=${encodeURIComponent(d.name)}` }, d.name) : h("span", {}, d.name),
              h("span", { class: "muted small" }, `  ${d.spec}`),
              c.kind === "unknown" ? h("span", { class: "pill is-warn" }, "not in index") : c.kind === "git" ? h("span", { class: "pill" }, "git") : c.kind === "path" ? h("span", { class: "pill" }, "path") : null,
            );
          }),
        ),
      );
    }

    clear(cmdsCard);
    const cmds = m.doc["commands"];
    const names = cmds ? Object.keys(cmds).filter((k) => !k.includes(".")) : [];
    if (cmds && names.length) {
      cmdsCard.append(
        side("Custom commands", h("ul", { class: "deps" }, ...names.map((n) => h("li", {}, h("code", {}, `bit ${n}`), h("span", { class: "muted small" }, `  ${cmds[`${n}.description`] ?? ""}`))))),
      );
    }
  };

  const loadManifestJob = async (): Promise<void> => {
    if (!repo) return;
    try {
      const res = await loadManifest(repo);
      if (res.value) fillManifest(res.value, res.stale, res.ageMs);
      else {
        compatCard.replaceChildren(h("p", { class: "muted small" }, "No Bit.hk in this repository."));
        depsCard.replaceChildren(h("p", { class: "muted small" }, "—"));
      }
    } catch {
      compatCard.replaceChildren(h("p", { class: "muted small" }, "Couldn't read the manifest (offline?)."));
      depsCard.replaceChildren(h("p", { class: "muted small" }, "—"));
    }
  };

  const loadUsedBy = async (): Promise<void> => {
    usedStop = false;
    const prog = h("p", { class: "muted small" }, "Scanning the index…");
    usedCard.replaceChildren(prog);
    const found = await scanUsedBy(entry, libs, (d, t) => (prog.textContent = `Scanning the index… ${d}/${t}`), () => usedStop);
    if (usedStop) return;
    usedCard.replaceChildren(
      found.length
        ? h("ul", { class: "deps" }, ...found.map((u) => h("li", {}, h("a", { href: `lib.html?name=${encodeURIComponent(u.lib.name)}` }, u.lib.name), h("span", { class: "muted small" }, `  ${u.spec}`))))
        : h("p", { class: "muted small" }, "No other library in the index depends on this one."),
      h("p", { class: "muted small" }, `Checked the manifests of ${libs.length - 1} other libraries.`),
    );
  };

  const loadReadmeJob = async (): Promise<void> => {
    if (!repo) {
      readmeBox.replaceChildren(h("h2", {}, "README"), h("p", { class: "muted" }, "README and manifest are read from GitHub; this library isn't hosted there."));
      return;
    }
    readmeBox.replaceChildren(h("h2", {}, "README"), h("p", { class: "muted" }, "Loading README…"));
    try {
      const res = await loadReadme(repo);
      if (!res.value) {
        readmeBox.replaceChildren(h("h2", {}, "README"), h("p", { class: "muted" }, "This repository has no README at its root."));
        return;
      }
      const { text, file, markdown } = res.value;
      const body = h("div", { class: "readme-body" });
      let mode: "rendered" | "raw" = markdown ? "rendered" : "raw";
      const toggle = h("button", { class: "copy", type: "button" }, "");
      const tocSlot = h("div", {});
      const draw = (): void => {
        tocSlot.replaceChildren();
        if (mode === "rendered") {
          const md = h("div", { class: "markdown-body" });
          try {
            md.append(renderMarkdown(text, { owner: repo.owner, repo: repo.repo, ref: repo.ref }));
            decorateCode(md);
            const toc = buildToc(md);
            if (toc) tocSlot.append(toc);
          } catch {
            mode = "raw"; // never leave the visitor with an empty README
          }
          if (mode === "rendered") body.replaceChildren(md);
        }
        if (mode === "raw") body.replaceChildren(h("pre", { class: "readme" }, text));
        toggle.textContent = mode === "rendered" ? "View raw" : "View rendered";
      };
      toggle.addEventListener("click", () => {
        mode = mode === "rendered" ? "raw" : "rendered";
        draw();
      });
      draw();
      const ghFile = `https://github.com/${repo.owner}/${repo.repo}/blob/${repo.ref.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(file)}`;
      readmeBox.replaceChildren(
        h(
          "div",
          { class: "readme-head" },
          h("h2", {}, "README"),
          h("span", { class: "grow" }),
          res.stale ? h("span", { class: "muted small" }, `saved copy · ${formatAge(res.ageMs)}`) : null,
          markdown ? toggle : null,
          h("a", { class: "copy", href: ghFile, target: "_blank", rel: "noopener" }, `${file} ↗`),
        ),
        tocSlot,
        body,
      );
    } catch {
      readmeBox.replaceChildren(h("h2", {}, "README"), h("p", { class: "muted" }, "Couldn't load the README. If you're offline, it is only available for libraries you opened before."));
    }
  };

  /* examples/ folder: files shown on demand, highlighted, with Copy */
  const loadExamples = async (): Promise<void> => {
    if (!repo) return;
    try {
      const tree = await loadTree(repo);
      const files = (tree.value?.files ?? [])
        .filter((f) => /^(examples?|samples?|demos?)\//i.test(f.path) && f.size <= 30_000 && !/\.(png|jpe?g|gif|webp|ico|bin|zip|gz|wasm)$/i.test(f.path))
        .slice(0, 8);
      if (files.length === 0) return;
      examplesBox.hidden = false;
      examplesBox.replaceChildren(h("h2", {}, "Examples"), ...files.map((f) => exampleItem(repo, f.path)));
    } catch {
      /* tree unavailable — examples are optional */
    }
  };

  const reload = (): void => {
    void loadStats();
    void loadPin();
    void loadManifestJob();
    void loadReadmeJob();
    void loadExamples();
    // the scan reads ~30 small files; start it once the page has settled
    window.setTimeout(() => void loadUsedBy(), 600);
  };
  reload();
  return { reload };
}

function exampleItem(repo: Repo, path: string): HTMLElement {
  const d = h("details", { class: "example" }, h("summary", {}, h("code", {}, path)));
  let loaded = false;
  d.addEventListener("toggle", () => {
    if (!d.open || loaded) return;
    loaded = true;
    const box = h("div", {}, h("p", { class: "muted small" }, "Loading…"));
    d.append(box);
    void loadFile(repo, path)
      .then((res) => {
        const text = res.value ?? "";
        const toks = highlight(text, extensionOf(path), path.split("/").pop() ?? path);
        const code = h("code", {}, ...toks.map((t) => (t.kind ? h("span", { class: `tok-${t.kind}` }, t.text) : document.createTextNode(t.text))));
        box.replaceChildren(
          h("div", { class: "snippet" }, h("pre", { class: "src-code" }, code), copyButton(text)),
          h("a", { class: "small", href: sourceHash(path) }, "Open in the source browser"),
        );
      })
      .catch(() => box.replaceChildren(h("p", { class: "muted small" }, "Couldn't load this example (offline?).")));
  });
  return d;
}

/** Markdown/HTML snippet for a "bit" badge (rendered by shields.io) linking back to this page. */
function badgeCard(entry: LibEntry): HTMLElement {
  const page = new URL(`lib.html?name=${encodeURIComponent(entry.name)}`, location.href).href;
  const img = `https://img.shields.io/badge/bit-${encodeURIComponent(entry.name.replace(/-/g, "--").replace(/_/g, "__"))}-ec4899`;
  const md = `[![bit](${img})](${page})`;
  const html = `<a href="${page}"><img src="${img}" alt="bit"></a>`;
  return side(
    "Badge",
    h("img", { src: img, alt: `bit: ${entry.name}`, referrerpolicy: "no-referrer", class: "badge-preview" }),
    h("div", { class: "cmd" }, h("span", { class: "muted small" }, "Markdown"), copyButton(md, "Copy")),
    h("div", { class: "cmd" }, h("span", { class: "muted small" }, "HTML"), copyButton(html, "Copy")),
  );
}
