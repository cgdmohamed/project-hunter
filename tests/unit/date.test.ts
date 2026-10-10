import { describe, expect, it } from 'vitest';
import { normalizeDigits, parsePublishedAt } from '../../src/utils/date.js';

describe('date parsing', () => {
  it('normalises Arabic-Indic digits', () => {
    expect(normalizeDigits('١٢٣٤٥')).toBe('12345');
  });

  it('parses ISO timestamps', () => {
    expect(parsePublishedAt('2025-06-01T12:00:00Z')).toBe('2025-06-01T12:00:00.000Z');
  });

  it('parses Arabic relative timestamps', () => {
    const fiveMin = parsePublishedAt('منذ 5 دقائق');
    expect(fiveMin).not.toBeNull();
    const delta = Date.now() - new Date(fiveMin as string).getTime();
    expect(delta).toBeGreaterThan(4 * 60_000);
    expect(delta).toBeLessThan(6 * 60_000);
  });

  it('returns null for unparseable values (never invents a date)', () => {
    expect(parsePublishedAt('غير معروف')).toBeNull();
    expect(parsePublishedAt(null)).toBeNull();
    expect(parsePublishedAt('')).toBeNull();
  });
});