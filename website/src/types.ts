export type Lang = "hsharp" | "hackerlang" | "hackerscript" | "any";

export interface LibEntry {
  name: string;
  target: string;
  description: string;
  tags: string[];
  author: string;
  lang: Lang;
  rev?: string;
  checksum?: string;
}

export interface LangInfo {
  id: Lang;
  label: string;
  short: string;
  color: string;
}

/** Parsed `Bit.hk` (sections → key → value; `--> sub` entries become "key.sub"). */
export type HkDoc = Record<string, Record<string, string>>;
