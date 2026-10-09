import type { LibEntry } from "./types.js";
import { langFromTags, normalizeLang } from "./langs.js";
import { cacheAge, cacheGetStale, cacheSet } from "./store.js";
import { clearStale, markStale } from "./offline.js";

/** Same document `bit` reads (see src/index.h#). */
export const INDEX_URL =
  "https://raw.githubusercontent.com/HackerOS-Linux-System/bit/main/index/repository.json";

/** Deployed copy first (same origin, no rate limits), GitHub raw as the fallback. */
const SOURCES = ["repository.json", INDEX_URL];

/** The hand-edited index has had trailing commas; strip them (outside strings) before parsing. */
export function parseLenient(text: string): unknown {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      if (text[j] !== "}" && text[j] !== "]") out += c;
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toEntry(raw: unknown): LibEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const name = str(o["name"]);
  if (!name) return null;
  const tags = Array.isArray(o["tags"]) ? o["tags"].filter((t): t is string => typeof t === "string") : [];
  const explicit = normalizeLang(str(o["lang"]));
  const entry: LibEntry = {
    name,
    target: str(o["target"]) || str(o["url"]) || str(o["git"]),
    description: str(o["description"]),
    tags,
    author: str(o["author"]),
    lang: explicit !== "any" ? explicit : langFromTags(tags),
  };
  const rev = str(o["rev"]);
  const checksum = str(o["checksum"]);
  if (rev) entry.rev = rev;
  if (checksum) entry.checksum = checksum;
  return entry;
}

export interface Index {
  updatedAt: string;
  libraries: LibEntry[];
}

const CACHE_KEY = "index";

export async function loadIndex(): Promise<Index> {
  let lastError: unknown = null;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const doc = parseLenient(await res.text()) as Record<string, unknown> | unknown[];
      const list = Array.isArray(doc) ? doc : (doc["libraries"] as unknown[] | undefined) ?? [];
      const libraries = list
        .map(toEntry)
        .filter((e): e is LibEntry => e !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
      const updatedAt = Array.isArray(doc) ? "" : str(doc["updated_at"]);
      const index = { updatedAt, libraries };
      cacheSet(CACHE_KEY, index, null); // kept for offline use; the network copy always wins while online
      clearStale("index");
      return index;
    } catch (e) {
      lastError = e;
    }
  }
  // No connection (or both sources down): serve the copy saved in this browser.
  const saved = cacheGetStale<Index>(CACHE_KEY);
  if (saved && Array.isArray(saved.libraries)) {
    markStale("index", cacheAge(CACHE_KEY));
    return saved;
  }
  throw lastError instanceof Error ? lastError : new Error("could not load the library index");
}

/** `https://github.com/owner/repo(.git)` → { owner, repo } */
export function parseGithub(url: string): { owner: string; repo: string } | null {
  const m = url.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/);
  return m && m[1] && m[2] ? { owner: m[1], repo: m[2] } : null;
}
