import { dependenciesOf } from "./deps.js";
import type { HkDoc } from "./types.js";

export interface DiffLine {
  t: " " | "+" | "-" | "…";
  s: string;
}

/** Line diff by longest common subsequence; null when the inputs are too big to compare cheaply. */
export function diffLines(a: string[], b: string[], context = 2): DiffLine[] | null {
  if (a.length > 1500 || b.length > 1500) return null;
  const n = a.length;
  const m = b.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      (lcs[i] as Uint16Array)[j] = a[i] === b[j] ? ((lcs[i + 1] as Uint16Array)[j + 1] as number) + 1 : Math.max((lcs[i + 1] as Uint16Array)[j] as number, (lcs[i] as Uint16Array)[j + 1] as number);
    }
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      all.push({ t: " ", s: a[i] as string });
      i++;
      j++;
    } else if (((lcs[i + 1] as Uint16Array)[j] as number) >= ((lcs[i] as Uint16Array)[j + 1] as number)) {
      all.push({ t: "-", s: a[i++] as string });
    } else {
      all.push({ t: "+", s: b[j++] as string });
    }
  }
  while (i < n) all.push({ t: "-", s: a[i++] as string });
  while (j < m) all.push({ t: "+", s: b[j++] as string });

  // keep only changed lines plus `context` lines around them
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((l, idx) => {
    if (l.t === " ") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(all.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  all.forEach((l, idx) => {
    if (keep[idx]) out.push(l);
    else if (out.length && out[out.length - 1]?.t !== "…") out.push({ t: "…", s: "" });
  });
  while (out.length && out[out.length - 1]?.t === "…") out.pop();
  return out;
}

/** Human summary of what changed between two manifests (version, dependencies). */
export function manifestChanges(older: HkDoc, newer: HkDoc): string[] {
  const out: string[] = [];
  const va = older["package"]?.["version"];
  const vb = newer["package"]?.["version"];
  if (va !== vb) out.push(`version ${va ?? "—"} → ${vb ?? "—"}`);
  const da = new Map(dependenciesOf(older).map((d) => [d.name, d.spec]));
  const db = new Map(dependenciesOf(newer).map((d) => [d.name, d.spec]));
  for (const [name, spec] of db) {
    if (!da.has(name)) out.push(`+ dependency ${name} ${spec}`.trim());
    else if (da.get(name) !== spec) out.push(`~ dependency ${name}: ${da.get(name) ?? ""} → ${spec}`);
  }
  for (const name of da.keys()) if (!db.has(name)) out.push(`− dependency ${name}`);
  return out;
}
