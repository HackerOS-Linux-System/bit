import type { HkDoc } from "./types.js";

/**
 * Reader for the `.hk` manifests (Bit.hk, Bytes.hk, Virus.hk):
 *   [section]
 *   -> key => value     ;; comment
 *   --> sub => value    (stored as "key.sub")
 *   key = "value"       (TOML-style lines are accepted too)
 * Mirrors src/hk.h# in the bit package manager.
 */
export function parseHk(source: string): HkDoc {
  const doc: HkDoc = {};
  let section = "";
  let lastKey = "";

  for (const raw of source.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";;") || line.startsWith("!") || line.startsWith("#")) continue;

    const sec = line.match(/^\[(.+)\]$/);
    if (sec && sec[1]) {
      section = normSection(sec[1]);
      lastKey = "";
      doc[section] ??= {};
      continue;
    }
    if (!section) continue;

    let body = line;
    let sub = false;
    if (body.startsWith("-->")) {
      body = body.slice(3).trim();
      sub = true;
    } else if (body.startsWith("->")) {
      body = body.slice(2).trim();
    }

    const arrow = body.indexOf("=>");
    const eq = body.indexOf("=");
    let key: string;
    let val = "";
    if (arrow >= 0) {
      key = body.slice(0, arrow);
      val = body.slice(arrow + 2);
    } else if (eq >= 0) {
      key = body.slice(0, eq);
      val = body.slice(eq + 1);
    } else {
      key = body;
    }
    key = unquote(key.trim());
    if (!key) continue;
    if (sub && lastKey) key = `${lastKey}.${key}`;
    else if (!sub) lastKey = key;

    (doc[section] ??= {})[key] = unquote(stripComment(val.trim()));
  }
  return doc;
}

/** `[Default build]`, `[default_build]` and `[default-build]` are one section. */
export function normSection(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function stripComment(v: string): string {
  let inStr = false;
  for (let i = 0; i < v.length - 1; i++) {
    if (v[i] === '"') inStr = !inStr;
    if (!inStr && v[i] === ";" && v[i + 1] === ";") return v.slice(0, i).trim();
  }
  return v;
}

function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

export function hkList(value: string | undefined): string[] {
  if (!value) return [];
  let t = value.trim();
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1);
  return t
    .split(",")
    .map((x) => unquote(x.trim()))
    .filter(Boolean);
}
