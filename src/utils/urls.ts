const PROJECT_PATH_RE = /\/project\/([^/?#]+)/i;

export interface ProjectUrlParts {
  externalId: string;
  canonicalUrl: string;
}

/**
 * Normalises an href (relative or absolute) against a base URL and ensures it
 * can be safely stored as a canonical project URL. Falls back to null when the
 * URL is not on the allowed origin is NOT enforced here (callers decide).
 */
export function resolveUrl(href: string | null, baseUrl: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('javascript:')) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/** Extracts `project/<id>` style identifiers from a project URL. */
export function extractProjectIdFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(PROJECT_PATH_RE);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function pathToProjectUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).href;
}

/** Removes tracking/query noise from a canonical URL. */
export function canonicalProjectUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}