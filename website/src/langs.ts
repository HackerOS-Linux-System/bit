import type { Lang, LangInfo } from "./types.js";

export const LANGS: LangInfo[] = [
  { id: "hsharp", label: "H#", short: "h#", color: "var(--lang-hsharp)" },
  { id: "hackerlang", label: "Hacker Lang", short: "hl", color: "var(--lang-hl)" },
  { id: "hackerscript", label: "HackerScript", short: "hs", color: "var(--lang-hs)" },
];

const ANY: LangInfo = { id: "any", label: "any", short: "any", color: "var(--muted)" };

export function langInfo(id: Lang): LangInfo {
  return LANGS.find((l) => l.id === id) ?? ANY;
}

/** Accepts every spelling people use: "h#", "H-Sharp", "hl", "Hacker Lang", "hcs"… */
export function normalizeLang(raw: string | undefined): Lang {
  const t = (raw ?? "").toLowerCase().replace(/[\s-]/g, "");
  if (t === "h#" || t === "hsharp" || t === "hsh") return "hsharp";
  if (t === "hl" || t === "hackerlang") return "hackerlang";
  if (t === "hs" || t === "hcs" || t === "hackerscript") return "hackerscript";
  return "any";
}

export function langFromTags(tags: string[]): Lang {
  for (const t of tags) {
    const l = normalizeLang(t);
    if (l !== "any") return l;
  }
  return "any";
}
