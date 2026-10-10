import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Stable fingerprint of a project's canonical content. Used to decide whether a
 * project changed meaningfully (in which case it should be analysed again).
 */
export function contentHash(input: Record<string, string | number | null | undefined>): string {
  const canonical = Object.keys(input)
    .sort()
    .map((key) => `${key}=${input[key] === null || input[key] === undefined ? '' : String(input[key])}`)
    .join('|');
  return sha256(canonical);
}

/** Lightweight fingerprint based only on listing-page data. */
export function fingerprint(input: Record<string, string | number | null | undefined>): string {
  return contentHash(input).slice(0, 24);
}