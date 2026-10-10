export function nowIso(): string {
  return new Date().toISOString();
}

const INDIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => INDIC_DIGITS[ch] ?? ch);
}

/**
 * Parses a published-at value into an ISO timestamp. Supports absolute dates and
 * common Arabic relative expressions ("منذ 5 دقائق", "منذ ساعة واحدة"...).
 * Returns null when the value cannot be reliably interpreted — we never invent
 * a publication date.
 */
export function parsePublishedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeDigits(value.trim());
  if (normalized === '') return null;

  const absolute = Date.parse(normalized);
  if (!Number.isNaN(absolute)) return new Date(absolute).toISOString();

  const relative = parseArabicRelative(normalized);
  return relative ? new Date(relative).toISOString() : null;
}

function parseArabicRelative(value: string): number | null {
  if (!value.includes('منذ') && !value.includes('قبل')) return null;

  const minutesRe = /(منذ|قبل)\s+(?:(\d+)\s+(?:دقيقة|دقائق|د))?/;
  const fullMinutes = value.match(/(\d+)\s*(?:دقيقة|دقائق)/);
  const fullHours = value.match(/(\d+)\s*(?:ساعة|ساعات)/);
  const fullDays = value.match(/(\d+)\s*(?:يوم|أيام|ايام)/);
  const fullWeeks = value.match(/(\d+)\s*(?:أسبوع|اسبوع|أسابيع|اسابيع)/);
  const singularHour = /ساعة واحدة/.test(value);
  const singularDay = /يوم واحد/.test(value) || /يوما واحدا/.test(value);
  const singleHourCount = value.match(/منذ\s+(?:ساعة|ساعتين)/);
  const singleDayCount = value.match(/منذ\s+(?:يومين|يومان)/);

  const now = Date.now();
  if (fullMinutes) return now - Number(fullMinutes[1]) * 60_000;
  if (fullHours) return now - Number(fullHours[1]) * 3_600_000;
  if (fullDays) return now - Number(fullDays[1]) * 86_400_000;
  if (fullWeeks) return now - Number(fullWeeks[1]) * 604_800_000;
  if (singularHour) return now - 3_600_000;
  if (singularDay) return now - 86_400_000;
  void minutesRe;
  void singleHourCount;
  void singleDayCount;
  return null;
}