import { afterEach, describe, expect, it, vi } from 'vitest';
import { RssAppSource } from '../../src/sources/rss-app/rss-app.source.js';
import { buildTestConfig } from '../support/testkit.js';

afterEach(() => vi.unstubAllGlobals());

describe('RSS.app project source', () => {
  it('discovers eligible project URLs and uses feed detail without Mostaql requests', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        items: [
          { id: 'p1', url: 'https://mostaql.com/projects/build-react-dashboard', title: 'React dashboard', content_text: 'Build a CRM', date_published: '2026-10-10T00:00:00Z' },
          { url: 'https://example.com/projects/not-mostaql', title: 'Not Mostaql' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const source = new RssAppSource(buildTestConfig({ RSS_FEED_URL: 'https://rss.app/feeds/v1.1/example.json' }));
    const [page] = await source.discoverProjects({ maxListingPages: 1 });
    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.title).toBe('React dashboard');
    const detail = await source.fetchProjectDetail('https://mostaql.com/projects/build-react-dashboard');
    expect(detail.description).toBe('Build a CRM');
    expect(detail.budgetRaw).toBeNull();
    expect(calls).toEqual(['https://rss.app/feeds/v1.1/example.json']);
  });

  it('rejects invalid feed payloads rather than reporting empty results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"foo":1}', { status: 200 })));
    const source = new RssAppSource(buildTestConfig({ RSS_FEED_URL: 'https://rss.app/feeds/v1.1/example.json' }));
    await expect(source.discoverProjects({ maxListingPages: 1 })).rejects.toThrow('no items array');
  });
});
