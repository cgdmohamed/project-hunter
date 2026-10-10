export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/\s+/g, ' ')
    .trim();
  return s === '' ? null : s;
}

export function cleanLines(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (cleaned === null) return null;
  return cleaned.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim() || null;
}

export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/** Strips content that appears to be an embedded prompt-injection attempt. */
export function sanitizeProjectText(value: string | null): string | null {
  const cleaned = cleanText(value);
  if (cleaned === null) return null;
  return cleaned.slice(0, 20_000);
}