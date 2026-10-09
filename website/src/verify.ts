import { fetchRawBytes, loadTree, pool, type Repo } from "./repodata.js";

export class VerifyError extends Error {}

const MAX_FILES = 400;
const MAX_BYTES = 20 * 1024 * 1024;

export async function sha256Hex(data: BufferSource): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new VerifyError("This browser can't hash here (needs HTTPS).");
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function compareBytes(a: string, b: string): number {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] as number) - (y[i] as number);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** The `bit` directory checksum from per-file hashes (pure — unit-tested against real sha256sum). */
export async function combineChecksum(files: Array<{ path: string; hex: string }>): Promise<string> {
  const rows = files.map((f) => ({ name: `./${f.path}`, hex: f.hex })).sort((a, b) => compareBytes(a.name, b.name));
  const listing = rows.map((r) => `${r.hex}  ${r.name}\n`).join("");
  return sha256Hex(new TextEncoder().encode(listing));
}

export interface VerifyResult {
  ok: boolean;
  actual: string;
  expected: string;
  files: number;
}

export function untag(s: string): string {
  return (s.startsWith("sha256:") ? s.slice(7) : s).trim().toLowerCase();
}

export async function verifyChecksum(repo: Repo, expectedTagged: string, onProgress: (done: number, total: number) => void): Promise<VerifyResult> {
  const expected = untag(expectedTagged);
  const tree = await loadTree(repo);
  if (!tree.value) throw new VerifyError(`Nothing found at "${repo.ref}".`);
  if (tree.value.truncated) throw new VerifyError("The repository is too large to verify here — run `bit` locally.");
  const files = tree.value.files.filter((f) => f.mode !== "120000" && !f.path.startsWith(".git/") && !f.path.startsWith(".bit/"));
  if (files.length === 0) throw new VerifyError("The repository has no files.");
  const total = files.reduce((a, f) => a + f.size, 0);
  if (files.length > MAX_FILES || total > MAX_BYTES) {
    throw new VerifyError(`${files.length} files / ${(total / 1048576).toFixed(1)} MB is too much to verify in a browser — run \`bit\` locally.`);
  }
  if (files.some((f) => /[\\\n]/.test(f.path))) throw new VerifyError("A file name contains a backslash or newline; sha256sum escapes those, so it can't be verified here.");

  const hashes: Array<{ path: string; hex: string }> = [];
  let done = 0;
  onProgress(0, files.length);
  await pool(files, 6, async (f) => {
    const bytes = await fetchRawBytes(repo, f.path);
    if (bytes === null) throw new VerifyError(`${f.path} could not be downloaded.`);
    hashes.push({ path: f.path, hex: await sha256Hex(bytes) });
    onProgress(++done, files.length);
  });
  const actual = await combineChecksum(hashes);
  return { ok: actual === expected, actual, expected, files: files.length };
}
