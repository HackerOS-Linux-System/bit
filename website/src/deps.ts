import { hkList } from "./hk.js";
import { parseGithub } from "./index-data.js";
import { loadManifest, pool } from "./repodata.js";
import type { HkDoc, LibEntry } from "./types.js";

export interface DepSpec {
  name: string;
  spec: string;
}

/** `[dependencies]` of a manifest: `-> mold => *`, `-> x => git URL v1`, or a `--> path => ../x` map. */
export function dependenciesOf(doc: HkDoc | undefined): DepSpec[] {
  const deps = doc?.["dependencies"];
  if (!deps) return [];
  return Object.keys(deps)
    .filter((k) => !k.includes("."))
    .map((name) => {
      const own = deps[name] ?? "";
      const subs = Object.keys(deps)
        .filter((k) => k.startsWith(`${name}.`))
        .map((k) => `${k.slice(name.length + 1)}=${deps[k] ?? ""}`);
      return { name, spec: own || subs.join(", ") };
    });
}

export type DepKind = "index" | "git" | "path" | "unknown";

export function classifyDep(d: DepSpec, libs: LibEntry[]): { kind: DepKind; lib?: LibEntry } {
  if (/^git\s/.test(d.spec) || /^https?:\/\//.test(d.spec)) return { kind: "git" };
  if (/^path\b|^path=/.test(d.spec)) return { kind: "path" };
  const lib = libs.find((l) => l.name.toLowerCase() === d.name.toLowerCase());
  return lib ? { kind: "index", lib } : { kind: "unknown" };
}

export interface Note {
  level: "ok" | "warn";
  text: string;
}

/** Things worth knowing before depending on a library, read from its manifest and the index. */
export function compatNotes(entry: LibEntry, doc: HkDoc, libs: LibEntry[]): Note[] {
  const notes: Note[] = [];
  const pkg = doc["package"] ?? {};
  const ed = doc["edition"] ?? {};
  if (ed["toolchain"]) notes.push({ level: "ok", text: `Needs the H# toolchain ${ed["toolchain"]} or newer (\`h# --version\`).` });
  if (ed["edition"]) notes.push({ level: "ok", text: `Edition ${ed["edition"]} (files without \`using "<year>"\` use it).` });
  const link = doc["build"]?.["link"];
  if (link && link !== "static") notes.push({ level: "warn", text: `[build] link => ${link} — bit only links statically and rejects this.` });
  const plat = doc["build"]?.["platform"];
  if (plat) notes.push({ level: "ok", text: `Cross-compiles for ${plat}.` });
  if (pkg["name"] && pkg["name"].toLowerCase() !== entry.name.toLowerCase()) {
    notes.push({ level: "warn", text: `The manifest calls this package "${pkg["name"]}", the index calls it "${entry.name}".` });
  }
  const langs = hkList(pkg["lang"]);
  if (langs.length === 0 && !pkg["lang"]) notes.push({ level: "ok", text: "No `lang` in the manifest — bit detects it from the file layout." });
  const missing = dependenciesOf(doc).filter((d) => classifyDep(d, libs).kind === "unknown");
  for (const d of missing) notes.push({ level: "warn", text: `Dependency "${d.name}" is not in the index (and isn't a git/path dependency).` });
  return notes;
}

export interface UsedBy {
  lib: LibEntry;
  spec: string;
}

/** Reverse dependencies: reads every other library's manifest (raw files, cached) and keeps the ones listing `target`. */
export async function scanUsedBy(
  target: LibEntry,
  libs: LibEntry[],
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean,
): Promise<UsedBy[]> {
  const others = libs.filter((l) => l.name.toLowerCase() !== target.name.toLowerCase() && parseGithub(l.target));
  const found: UsedBy[] = [];
  let done = 0;
  onProgress(0, others.length);
  await pool(
    others,
    4,
    async (lib) => {
      const gh = parseGithub(lib.target);
      if (gh) {
        try {
          const res = await loadManifest({ ...gh, ref: lib.rev || "HEAD" });
          const hit = dependenciesOf(res.value?.doc).find((d) => d.name.toLowerCase() === target.name.toLowerCase());
          if (hit) found.push({ lib, spec: hit.spec });
        } catch {
          /* unreachable / nothing saved for this one — skip it */
        }
      }
      onProgress(++done, others.length);
    },
    shouldStop,
  );
  return found.sort((a, b) => a.lib.name.localeCompare(b.lib.name));
}
