export const LANGUAGE_COLORS: Record<string, string> = {
  // the HackerOS ecosystem
  "H#": "#9c1120",
  "H# Interface": "#c23b4e",
  hk: "#ffffff",
  HackerScript: "#8a8a94",
  "Hacker Lang": "#8250df",
  // common languages (GitHub's colours)
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  PowerShell: "#012456",
  Scala: "#c22d40",
  Haskell: "#5e5086",
  Lua: "#000080",
  Perl: "#0298c3",
  R: "#198CE7",
  "Objective-C": "#438eff",
  Elixir: "#6e4a7e",
  Clojure: "#db5855",
  Zig: "#ec915c",
  OCaml: "#3be133",
  Erlang: "#B83998",
  Julia: "#a270ba",
  "Vim script": "#199f4b",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Assembly: "#6E4C13",
  Crystal: "#000100",
  Nim: "#ffc200",
  Solidity: "#AA6746",
};

const CUSTOM = new Set(["H#", "H# Interface", "hk", "HackerScript", "Hacker Lang"]);
const FALLBACK = "#8f8fa3";

/** extension (lowercase, no leading dot) → language. `.hk`, `.hcs`, `.h#`, `.h#i` and `.hl` are the HackerOS ones. */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  "h#": "H#",
  "h#i": "H# Interface",
  hk: "hk",
  hcs: "HackerScript",
  hl: "Hacker Lang",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript",
  py: "Python", pyw: "Python",
  java: "Java",
  c: "C", h: "C",
  cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hh: "C++", hxx: "C++",
  cs: "C#",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  kt: "Kotlin", kts: "Kotlin",
  dart: "Dart",
  html: "HTML", htm: "HTML",
  css: "CSS",
  sh: "Shell", bash: "Shell", zsh: "Shell",
  ps1: "PowerShell", psm1: "PowerShell",
  scala: "Scala", sc: "Scala",
  hs: "Haskell", lhs: "Haskell",
  lua: "Lua",
  pl: "Perl", pm: "Perl",
  r: "R",
  m: "Objective-C", mm: "Objective-C",
  ex: "Elixir", exs: "Elixir",
  clj: "Clojure", cljs: "Clojure", cljc: "Clojure",
  zig: "Zig",
  ml: "OCaml", mli: "OCaml",
  erl: "Erlang", hrl: "Erlang",
  jl: "Julia",
  vim: "Vim script",
  vue: "Vue",
  svelte: "Svelte",
  asm: "Assembly", s: "Assembly",
  cr: "Crystal",
  nim: "Nim",
  sol: "Solidity",
  // md / json / yml are deliberately not counted: docs and config would dominate small libraries
};

export function colorForLanguage(name: string): string {
  return LANGUAGE_COLORS[name] ?? FALLBACK;
}

export function isCustomLanguage(name: string): boolean {
  return CUSTOM.has(name);
}

/** Near-white swatches need an outline against a light background. */
export function needsOutline(name: string): boolean {
  return name === "hk";
}

/** "src/main.h#" → "h#", "Bit.hk" → "hk", "Makefile" → "" (handles multi-char extensions like h#i). */
export function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.indexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

export interface LangShare {
  name: string;
  bytes: number;
  pct: number;
}

export function breakdownFromTree(entries: TreeEntry[]): LangShare[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "blob") continue;
    const ext = extensionOf(e.path);
    // "foo.test.ts" → try "test.ts" first, then the last segment
    const lang = EXTENSION_TO_LANGUAGE[ext] ?? EXTENSION_TO_LANGUAGE[ext.split(".").pop() ?? ""];
    if (!lang) continue;
    totals.set(lang, (totals.get(lang) ?? 0) + (e.size ?? 0));
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (sum === 0) return [];
  return [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes, pct: (bytes / sum) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);
}
