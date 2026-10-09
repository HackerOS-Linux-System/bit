import { cacheAge, cacheGet, cacheGetStale, cacheSet, TTL } from "./store.js";
import { clearStale, isOffline, markStale } from "./offline.js";
import { GithubError, githubApi, rateLimitNote } from "./github.js";
import { parseHk } from "./hk.js";
import type { HkDoc } from "./types.js";

export interface Repo {
  owner: string;
  repo: string;
  ref: string;
}

export class NetworkError extends Error {}

export interface Loaded<T> {
  value: T | null;
  stale: boolean;
  ageMs: number | null;
}

export async function loadCached<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T | null>,
  label = key,
): Promise<Loaded<T>> {
  const fresh = cacheGet<T>(key);
  if (fresh !== null) {
    clearStale(label);
    return { value: fresh, stale: false, ageMs: cacheAge(key) };
  }
  const useStale = (err: unknown): Loaded<T> => {
    const old = cacheGetStale<T>(key);
    if (old === null) throw err;
    const age = cacheAge(key);
    markStale(label, age);
    return { value: old, stale: true, ageMs: age };
  };
  if (isOffline()) return useStale(new NetworkError("offline"));
  try {
    const v = await fetcher();
    if (v !== null) cacheSet(key, v, ttl);
    clearStale(label);
    return { value: v, stale: false, ageMs: 0 };
  } catch (e) {
    return useStale(e);
  }
}

/** raw.githubusercontent.com has no API quota and never gets the token. null = 404. */
/** The first candidate alone (the common case = one request), the alternative spellings only when it's missing. */
async function firstHit(r: Repo, candidates: string[]): Promise<{ file: string; text: string } | null> {
  const [head, ...rest] = candidates;
  if (head === undefined) return null;
  const first = await fetchRaw(r, head);
  if (first !== null) return { file: head, text: first };
  const hits = await Promise.all(rest.map((f) => fetchRaw(r, f)));
  const i = hits.findIndex((t) => t !== null);
  const file = rest[i];
  const text = hits[i];
  return i >= 0 && file !== undefined && text !== null && text !== undefined ? { file, text } : null;
}

export async function fetchRaw(r: Repo, path: string): Promise<string | null> {
  const ref = r.ref.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new NetworkError("network");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new NetworkError(`HTTP ${res.status}`);
  return res.text();
}

const key = (kind: string, r: Repo, extra = ""): string => `${kind}:${r.owner}/${r.repo}@${r.ref}${extra}`;

/* ------------------------------------------------------------------ manifest */

const MANIFESTS = ["Bit.hk", "bit.hk", "Bytes.hk", "Virus.hk"];

export interface ManifestSrc {
  file: string;
  text: string;
}

export async function loadManifest(r: Repo): Promise<Loaded<{ file: string; doc: HkDoc; text: string }>> {
  const res = await loadCached<ManifestSrc>(key("manifest", r), TTL.MANIFEST, async () => {
    const hit = await firstHit(r, MANIFESTS);
    return hit ? { file: hit.file, text: hit.text.slice(0, 100_000) } : null;
  }, "manifest");
  return {
    ...res,
    value: res.value ? { file: res.value.file, doc: parseHk(res.value.text), text: res.value.text } : null,
  };
}

/* -------------------------------------------------------------------- readme */

const README_FILES = ["README.md", "Readme.md", "readme.md", "README.markdown", "README.MD", "README", "README.txt", "README.rst"];

export interface ReadmeSrc {
  file: string;
  text: string;
  markdown: boolean;
}

export function loadReadme(r: Repo): Promise<Loaded<ReadmeSrc>> {
  return loadCached<ReadmeSrc>(key("readme", r), TTL.README, async () => {
    const hit = await firstHit(r, README_FILES);
    return hit ? { file: hit.file, text: hit.text.slice(0, 200_000), markdown: /\.(md|markdown)$/i.test(hit.file) } : null;
  }, "readme");
}

/* ---------------------------------------------------------------------- tree */

export interface FileEntry {
  path: string;
  size: number;
  /** git file mode ("100644", "100755", "120000" = symlink); absent in copies saved by older versions */
  mode?: string;
}

export interface RepoTree {
  truncated: boolean;
  files: FileEntry[];
}

const MAX_FILES = 6000;
const inflight = new Map<string, Promise<Loaded<RepoTree>>>();

/** One recursive listing, shared by the language bar and the source browser. */
export function loadTree(r: Repo): Promise<Loaded<RepoTree>> {
  const k = key("tree", r);
  const running = inflight.get(k);
  if (running) return running;
  const p = loadCached<RepoTree>(k, TTL.TREE, async () => {
    const res = await githubApi(`/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(r.ref)}?recursive=1`);
    throwForStatus(res);
    if (res.status === 404 || res.status === 409) return null; // 409 = empty repository
    if (!res.ok) throw new GithubError(`GitHub API → HTTP ${res.status}`, res.status);
    const data = (await res.json()) as { tree?: Array<{ path: string; type: string; size?: number; mode?: string }>; truncated?: boolean };
    if (!Array.isArray(data.tree)) return null;
    const files = data.tree.filter((e) => e.type === "blob").slice(0, MAX_FILES).map((e) => ({ path: e.path, size: e.size ?? 0, mode: e.mode }));
    return { truncated: !!data.truncated || data.tree.length > MAX_FILES, files };
  }, "tree").finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** 401 / 403 → a GithubError whose message tells the visitor what to do. */
export function throwForStatus(res: Response): void {
  if (res.status === 401) throw new GithubError("The saved GitHub token was rejected (401) — check it in Settings.", 401);
  if (res.status === 403 || res.status === 429) {
    const note = rateLimitNote();
    throw new GithubError(`GitHub API rate limit reached${note ? ` (${note})` : ""}. Adding a token in Settings raises it.`, 403);
  }
}

/* ------------------------------------------------------------------ releases */

export interface Asset {
  name: string;
  size: number;
  downloads: number;
  url: string;
}

export interface Release {
  tag: string;
  name: string;
  date: string;
  prerelease: boolean;
  draft: boolean;
  url: string;
  body: string;
  assets: Asset[];
  /** true when this row came from /tags (no release was published for it) */
  tagOnly?: boolean;
}

interface RawRelease {
  tag_name?: string;
  name?: string | null;
  published_at?: string | null;
  created_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  html_url?: string;
  body?: string | null;
  assets?: Array<{ name?: string; size?: number; download_count?: number; browser_download_url?: string }>;
}

export function loadReleases(r: Pick<Repo, "owner" | "repo">): Promise<Loaded<Release[]>> {
  const repo: Repo = { ...r, ref: "" };
  return loadCached<Release[]>(`releases:${repo.owner}/${repo.repo}`, TTL.RELEASES, async () => {
    const res = await githubApi(`/repos/${repo.owner}/${repo.repo}/releases?per_page=50`);
    throwForStatus(res);
    if (res.status === 404) return null;
    if (!res.ok) throw new GithubError(`GitHub API → HTTP ${res.status}`, res.status);
    const raw = (await res.json()) as RawRelease[];
    const releases: Release[] = (Array.isArray(raw) ? raw : [])
      .filter((x) => x.tag_name)
      .map((x) => ({
        tag: x.tag_name ?? "",
        name: x.name ?? "",
        date: x.published_at ?? x.created_at ?? "",
        prerelease: !!x.prerelease,
        draft: !!x.draft,
        url: x.html_url ?? `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(x.tag_name ?? "")}`,
        body: (x.body ?? "").slice(0, 6000),
        assets: (x.assets ?? []).map((a) => ({
          name: a.name ?? "file",
          size: a.size ?? 0,
          downloads: a.download_count ?? 0,
          url: a.browser_download_url ?? "",
        })),
      }));
    if (releases.length > 0) return releases;

    // No releases published: fall back to plain tags so the section is still useful.
    const t = await githubApi(`/repos/${repo.owner}/${repo.repo}/tags?per_page=50`);
    throwForStatus(t);
    if (!t.ok) return [];
    const tags = (await t.json()) as Array<{ name?: string }>;
    return (Array.isArray(tags) ? tags : [])
      .filter((x) => x.name)
      .map((x) => ({
        tag: x.name ?? "",
        name: "",
        date: "",
        prerelease: false,
        draft: false,
        url: `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(x.name ?? "")}`,
        body: "",
        assets: [],
        tagOnly: true,
      }));
  }, "releases");
}

/* --------------------------------------------------------------- source file */

/** A file opened in the source browser, cached so it can be read again offline. null = 404. */
export function loadFile(r: Repo, path: string): Promise<Loaded<string>> {
  return loadCached<string>(key("src", r, `:${path}`), TTL.FILE, () => fetchRaw(r, path), "source");
}

/** Already-saved copy of a file (no network, no staleness check). */
export function peekFile(r: Repo, path: string): string | null {
  return cacheGetStale<string>(key("src", r, `:${path}`));
}

/* ----------------------------------------------------------------- repo meta */

export interface RepoMeta {
  stars: number;
  forks: number;
  issues: number;
  watchers: number;
  license: string;
  pushedAt: string;
  createdAt: string;
  archived: boolean;
  defaultBranch: string;
  topics: string[];
  homepage: string;
  size: number;
}

interface RawMeta {
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  subscribers_count?: number;
  license?: { spdx_id?: string | null; name?: string } | null;
  pushed_at?: string;
  created_at?: string;
  archived?: boolean;
  default_branch?: string;
  topics?: string[];
  homepage?: string | null;
  size?: number;
}

export function loadRepoMeta(r: Pick<Repo, "owner" | "repo">): Promise<Loaded<RepoMeta>> {
  return loadCached<RepoMeta>(`meta:${r.owner}/${r.repo}`, TTL.META, async () => {
    const res = await githubApi(`/repos/${r.owner}/${r.repo}`);
    throwForStatus(res);
    if (res.status === 404) return null;
    if (!res.ok) throw new GithubError(`GitHub API → HTTP ${res.status}`, res.status);
    const d = (await res.json()) as RawMeta;
    const lic = d.license?.spdx_id && d.license.spdx_id !== "NOASSERTION" ? d.license.spdx_id : (d.license?.name ?? "");
    return {
      stars: d.stargazers_count ?? 0,
      forks: d.forks_count ?? 0,
      issues: d.open_issues_count ?? 0,
      watchers: d.subscribers_count ?? 0,
      license: lic,
      pushedAt: d.pushed_at ?? "",
      createdAt: d.created_at ?? "",
      archived: !!d.archived,
      defaultBranch: d.default_branch ?? "",
      topics: Array.isArray(d.topics) ? d.topics : [],
      homepage: d.homepage ?? "",
      size: d.size ?? 0,
    };
  }, "meta");
}

/* ------------------------------------------------------------- pinned rev */

export interface ResolvedRev {
  sha: string;
  date: string;
  message: string;
}

/** What a tag / branch / commit id points to right now (one api.github.com call). null = not found. */
export function resolveRev(r: Repo): Promise<Loaded<ResolvedRev>> {
  return loadCached<ResolvedRev>(key("rev", r), TTL.REV, async () => {
    const res = await githubApi(`/repos/${r.owner}/${r.repo}/commits/${encodeURIComponent(r.ref)}`);
    throwForStatus(res);
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw new GithubError(`GitHub API → HTTP ${res.status}`, res.status);
    const d = (await res.json()) as { sha?: string; commit?: { message?: string; committer?: { date?: string } } };
    if (!d.sha) return null;
    return { sha: d.sha, date: d.commit?.committer?.date ?? "", message: (d.commit?.message ?? "").split("\n")[0] ?? "" };
  }, "rev");
}

/** The commit a pinned rev pointed to the last time this browser looked (to notice a moved tag). */
export function seenSha(r: Repo): string | null {
  return cacheGetStale<string>(key("seen", r));
}

export function rememberSha(r: Repo, sha: string): void {
  cacheSet(key("seen", r), sha, null);
}

/* ------------------------------------------------------- lazy directories */

export interface DirListing {
  files: FileEntry[];
  dirs: string[];
}

/** One directory ("" = root) of a repository whose recursive listing was truncated (contents API). */
export async function loadDir(r: Repo, dir: string): Promise<DirListing | null> {
  const k = key("dir", r, `:${dir}`);
  const res = await loadCached<DirListing>(k, TTL.TREE, async () => {
    const path = dir ? `/${dir.split("/").map(encodeURIComponent).join("/")}` : "";
    const resp = await githubApi(`/repos/${r.owner}/${r.repo}/contents${path}?ref=${encodeURIComponent(r.ref)}`);
    throwForStatus(resp);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new GithubError(`GitHub API → HTTP ${resp.status}`, resp.status);
    const list = (await resp.json()) as Array<{ path: string; type: string; size?: number }>;
    if (!Array.isArray(list)) return { files: [], dirs: [] };
    return {
      files: list.filter((e) => e.type === "file").map((e) => ({ path: e.path, size: e.size ?? 0 })),
      dirs: list.filter((e) => e.type === "dir").map((e) => e.path),
    };
  }, "source");
  return res.value;
}

/* --------------------------------------------------------- light file access */

const memFiles = new Map<string, string | null>();

/**
 * A file for bulk readers (code search, API docs): the saved copy if there is one, else a plain
 * raw fetch kept in memory only — so reading hundreds of files never fills localStorage.
 */
export async function readFileLight(r: Repo, path: string): Promise<string | null> {
  const k = key("src", r, `:${path}`);
  const saved = cacheGetStale<string>(k);
  if (saved !== null) return saved;
  if (memFiles.has(k)) return memFiles.get(k) ?? null;
  const text = await fetchRaw(r, path);
  memFiles.set(k, text);
  return text;
}

/** Raw bytes of a file (checksum verification). null = 404. */
export async function fetchRawBytes(r: Repo, path: string): Promise<ArrayBuffer | null> {
  const ref = r.ref.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new NetworkError("network");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new NetworkError(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Runs fn over items with at most `limit` in flight; stops early when shouldStop() turns true. */
export async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>, shouldStop: () => boolean = () => false): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length && !shouldStop()) {
      const i = cursor++;
      await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
