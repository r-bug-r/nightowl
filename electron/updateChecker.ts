import type { UpdateCheckResult } from "./types";

export const RELEASES_PAGE_URL = "https://github.com/r-bug-r/nightowl/releases";
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/r-bug-r/nightowl/releases/latest";

const ALLOWED_EXTERNAL_PREFIXES = [
  "https://github.com/r-bug-r/nightowl",
  "https://nightowl.sheif.org",
];

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const normalized = parsed.toString();
    return ALLOWED_EXTERNAL_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
    );
  } catch {
    return false;
  }
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(cleaned);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** Returns -1 if a < b, 0 if equal, 1 if a > b. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) {
    if (pa.prerelease === pb.prerelease) return 0;
    return pa.prerelease < pb.prerelease ? -1 : 1;
  }
  return 0;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function checkForUpdates(
  currentVersion: string,
  fetchImpl: FetchLike = fetch
): Promise<UpdateCheckResult> {
  const checkedAt = Date.now();
  const normalizedCurrent = currentVersion.replace(/^v/i, "");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetchImpl(LATEST_RELEASE_API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Nightowl/${normalizedCurrent}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return {
        status: "error",
        currentVersion: normalizedCurrent,
        latestVersion: null,
        releaseUrl: RELEASES_PAGE_URL,
        checkedAt,
        error: `GitHub API returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const tagName = typeof data.tag_name === "string" ? data.tag_name.trim() : "";
    const latestVersion = tagName.replace(/^v/i, "");
    if (!latestVersion) {
      return {
        status: "error",
        currentVersion: normalizedCurrent,
        latestVersion: null,
        releaseUrl: RELEASES_PAGE_URL,
        checkedAt,
        error: "Latest release tag was missing from response.",
      };
    }

    const candidateUrl = typeof data.html_url === "string" ? data.html_url.trim() : "";
    const releaseUrl = isAllowedExternalUrl(candidateUrl) ? candidateUrl : RELEASES_PAGE_URL;
    const cmp = compareSemver(normalizedCurrent, latestVersion);

    return {
      status: cmp < 0 ? "update-available" : "up-to-date",
      currentVersion: normalizedCurrent,
      latestVersion,
      releaseUrl,
      checkedAt,
    };
  } catch (err) {
    return {
      status: "error",
      currentVersion: normalizedCurrent,
      latestVersion: null,
      releaseUrl: RELEASES_PAGE_URL,
      checkedAt,
      error: err instanceof Error ? err.message : "Could not check GitHub releases.",
    };
  }
}
