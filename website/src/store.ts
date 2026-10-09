const PREFIX = "bitio:cache:";

export const TTL = {
  MANIFEST: 45 * 60 * 1000, // Bit.hk read from the repository
  README: 45 * 60 * 1000, // README source
  TREE: 2 * 60 * 60 * 1000, // recursive file tree (one api.github.com call, shared by the language bar and the source browser)
  FILE: 2 * 60 * 60 * 1000, // a source file opened in the browser
  META: 2 * 60 * 60 * 1000, // repository stats (stars, forks…)
  REV: 60 * 60 * 1000, // what a pinned rev resolves to
  RELEASES: 30 * 60 * 1000, // GitHub releases (one api.github.com call)
} as const;

interface Envelope<T> {
  value: T;
  expires: number | null;
  savedAt: number;
}

function read<T>(key: string): Envelope<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    return typeof env === "object" && env !== null && "value" in env ? env : null;
  } catch {
    return null;
  }
}

/** The value only while it is still fresh. */
export function cacheGet<T>(key: string): T | null {
  const env = read<T>(key);
  if (!env) return null;
  if (env.expires !== null && Date.now() > env.expires) return null;
  return env.value;
}

/** The value even when expired — used when the network failed. */
export function cacheGetStale<T>(key: string): T | null {
  return read<T>(key)?.value ?? null;
}

/** Age in ms of a saved entry, or null. */
export function cacheAge(key: string): number | null {
  const env = read<unknown>(key);
  return env ? Date.now() - env.savedAt : null;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number | null): boolean {
  const env: Envelope<T> = { value, expires: ttlMs ? Date.now() + ttlMs : null, savedAt: Date.now() };
  const payload = JSON.stringify(env);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      localStorage.setItem(PREFIX + key, payload);
      return true;
    } catch {
      // Quota is full (or storage is blocked): drop the oldest saved entry and retry.
      if (!evictOldest(key)) return false;
    }
  }
  return false;
}

function cacheKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
    }
  } catch {
    /* storage unavailable */
  }
  return keys;
}

function evictOldest(except: string): boolean {
  let oldest: { key: string; at: number } | null = null;
  for (const k of cacheKeys()) {
    if (k === except || k === "index") continue; // the index is what makes the site open offline
    const at = read<unknown>(k)?.savedAt ?? 0;
    if (!oldest || at < oldest.at) oldest = { key: k, at };
  }
  if (!oldest) return false;
  try {
    localStorage.removeItem(PREFIX + oldest.key);
    return true;
  } catch {
    return false;
  }
}

export interface CacheStats {
  entries: number;
  bytes: number;
  libraries: number;
}

export function cacheStats(): CacheStats {
  let bytes = 0;
  const libs = new Set<string>();
  const keys = cacheKeys();
  for (const k of keys) {
    try {
      bytes += (localStorage.getItem(PREFIX + k) ?? "").length * 2; // UTF-16
    } catch {
      /* ignore */
    }
    const m = k.match(/^(?:manifest|readme|tree|src|releases|meta|rev|dir|api):(.+?)(?:@|$)/);
    if (m?.[1]) libs.add(m[1]);
  }
  return { entries: keys.length, bytes, libraries: libs.size };
}

export function cacheClear(): void {
  for (const k of cacheKeys()) {
    try {
      localStorage.removeItem(PREFIX + k);
    } catch {
      /* ignore */
    }
  }
}

export function formatAge(ms: number | null): string {
  if (ms === null) return "earlier";
  const min = 60_000;
  if (ms < 20_000) return "just now";
  if (ms < min) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 60 * min) return `${Math.round(ms / min)} min ago`;
  if (ms < 24 * 60 * min) return `${Math.round(ms / (60 * min))} h ago`;
  return `${Math.round(ms / (24 * 60 * min))} d ago`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
