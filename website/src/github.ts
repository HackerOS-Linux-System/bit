const TOKEN_KEY = "bitio:gh-token";
const API_HOST = "api.github.com";

export function getGithubToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setGithubToken(token: string): boolean {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}

export function hasGithubToken(): boolean {
  return getGithubToken() !== "";
}

export interface RateLimit {
  remaining: number;
  limit: number | null;
  resetAt: number | null; // ms since epoch
}

let lastRate: RateLimit | null = null;

function trackRate(res: Response): void {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining === null) return;
  const limit = res.headers.get("x-ratelimit-limit");
  const reset = res.headers.get("x-ratelimit-reset");
  lastRate = {
    remaining: Number(remaining),
    limit: limit !== null ? Number(limit) : null,
    resetAt: reset !== null ? Number(reset) * 1000 : null,
  };
}

export function knownRateLimit(): RateLimit | null {
  return lastRate;
}

export function rateLimitNote(): string | null {
  if (!lastRate?.resetAt) return null;
  const left = lastRate.resetAt - Date.now();
  if (left <= 0) return "resets any moment now";
  const clock = new Date(lastRate.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `resets in ~${Math.max(1, Math.ceil(left / 60_000))} min (~${clock})`;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** fetch() against api.github.com with the token attached when one is saved. */
export async function githubApi(path: string): Promise<Response> {
  const url = `https://${API_HOST}${path}`;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = getGithubToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  trackRate(res);
  return res;
}

/** Rate limit of the credentials in use. /rate_limit itself does not count against the quota. */
export async function fetchRateLimit(): Promise<{ ok: boolean; status: number; rate: RateLimit | null }> {
  const res = await githubApi("/rate_limit");
  if (!res.ok) return { ok: false, status: res.status, rate: null };
  const data = (await res.json()) as { resources?: { core?: { remaining: number; limit: number; reset: number } } };
  const core = data.resources?.core;
  return {
    ok: true,
    status: res.status,
    rate: core ? { remaining: core.remaining, limit: core.limit, resetAt: core.reset * 1000 } : null,
  };
}
