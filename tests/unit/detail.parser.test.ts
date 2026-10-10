import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTORS } from '../../src/config/selectors.js';
import { parseProjectDetail } from '../../src/sources/mostaql/detail.parser.js';
import { loadFixture } from '../support/testkit.js';

describe('detail parser', () => {
  const BASE = 'https://mostaql.com';

  it('extracts a full project detail', () => {
    const parsed = parseProjectDetail(loadFixture('detail.html'), BASE, DEFAULT_SELECTORS);

    expect(parsed.title).toBe('نظام إدارة مطعم شامل');
    expect(parsed.description).toContain('نظام متكامل لإدارة المطعم');
    expect(parsed.budgetRaw).toContain('$500 - $2,500');
    expect(parsed.proposalCount).toBe(18);
    expect(parsed.publishedAt).toBe('2025-06-01T12:00:00.000Z');
    expect(parsed.expectedDuration).toContain('من 2 إلى 4 أسابيع');
    expect(parsed.projectStatus).toBe('open');
    expect(parsed.skills).toEqual(['استشارة وتخطيط', 'تطوير ويب']);
    expect(parsed.structure).toEqual({ title: true, description: true, budget: true });
  });

  it('falls back to meta tags for title and description', () => {
    const html = `<html><head>
        <meta property="og:title" content="مشروع من ميتا">
        <meta property="og:description" content="وصف من ميتا">
      </head><body><p>محتوى</p></body></html>`;
    const parsed = parseProjectDetail(html, BASE, DEFAULT_SELECTORS);
    expect(parsed.title).toBe('مشروع من ميتا');
    expect(parsed.description).toBe('وصف من ميتا');
  });

  it('returns nulls for missing fields instead of inventing values', () => {
    const parsed = parseProjectDetail('<html><body><h1>فقط عنوان</h1></body></html>', BASE, DEFAULT_SELECTORS);
    expect(parsed.title).toBe('فقط عنوان');
    expect(parsed.description).toBeNull();
    expect(parsed.budgetRaw).toBeNull();
    expect(parsed.proposalCount).toBeNull();
    expect(parsed.publishedAt).toBeNull();
    expect(parsed.structure.description).toBe(false);
    expect(parsed.structure.budget).toBe(false);
  });

  it('parses an open (نegotiable) budget as open', () => {
    const html = `<html><h1>مشروع</h1><div class="project-budget">الميزانية مفتوحة</div></html>`;
    const parsed = parseProjectDetail(html, BASE, DEFAULT_SELECTORS);
    expect(parsed.budgetRaw).toBe('الميزانية مفتوحة');
  });
});