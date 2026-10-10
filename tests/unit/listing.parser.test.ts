import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTORS } from '../../src/config/selectors.js';
import { parseListingPage } from '../../src/sources/mostaql/listing.parser.js';
import { loadFixture } from '../support/testkit.js';

describe('listing parser', () => {
  const BASE = 'https://mostaql.com';

  it('extracts project links from a listing page', () => {
    const result = parseListingPage(loadFixture('listing.html'), BASE, DEFAULT_SELECTORS);

    expect(result.items.length).toBe(4);
    const ids = result.items.map((item) => item.externalId);
    expect(ids).toEqual([
      'first-project-1001',
      'second-project-1002',
      'third-project-1003',
      'small-budget-1004',
    ]);
  });

  it('produces absolute canonical URLs', () => {
    const result = parseListingPage(loadFixture('listing.html'), BASE, DEFAULT_SELECTORS);

    for (const item of result.items) {
      expect(item.canonicalUrl).toBe(`https://mostaql.com/project/${item.externalId}`);
    }
  });

  it('extracts a title when present', () => {
    const result = parseListingPage(loadFixture('listing.html'), BASE, DEFAULT_SELECTORS);
    expect(result.items[0]?.title).toBe('بناء نظام حجوزات وإدارة عملاء');
  });

  it('ignores navigation links that are not real projects', () => {
    const html = `<a href="/project/search">بحث</a><a href="/project/create">إنشاء</a><a href="/project/real-project-1">مشروع حقيقي</a>`;
    const result = parseListingPage(html, BASE, DEFAULT_SELECTORS);
    expect(result.items.map((i) => i.externalId)).toEqual(['real-project-1']);
  });

  it('ignores external links and deduplicates repeated ids', () => {
    const html = `
      <a href="https://other-site.com/project/x">خارجي</a>
      <a href="/project/dup-1">أول</a>
      <a href="/project/dup-1">ثانٍ (تكرار)</a>
    `;
    const result = parseListingPage(html, BASE, DEFAULT_SELECTORS);
    expect(result.items.length).toBe(1);
    expect(result.rawLinksFound).toBe(1);
  });

  it('reports zero items when the structure changed', () => {
    const result = parseListingPage('<div>nothing here</div>', BASE, DEFAULT_SELECTORS);
    expect(result.items.length).toBe(0);
    expect(result.rawLinksFound).toBe(0);
  });
});