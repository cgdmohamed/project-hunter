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

  it('parses RSS XML CDATA and project singular links without fabricating budgets', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title><![CDATA[ إدارة حساب سناب شات ]]></title>
      <description><![CDATA[<div><img src="https://example.com/a.png" /><div>محتوى يومي وكتابة فيديوهات</div></div>]]></description>
      <link>https://mostaql.com/project/1165871-example</link>
      <guid isPermaLink="false">ad60d04902e8151e52fa05a577c574b9</guid>
      <pubDate>Fri, 09 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } })));
    const source = new RssAppSource(buildTestConfig({ RSS_FEED_URL: 'https://rss.app/feeds/example.xml' }));
    const [page] = await source.discoverProjects({ maxListingPages: 1 });
    expect(page?.items).toHaveLength(1);
    const detail = await source.fetchProjectDetail('https://mostaql.com/project/1165871-example');
    expect(detail.title).toBe('إدارة حساب سناب شات');
    expect(detail.description).toContain('محتوى يومي');
    expect(detail.description).not.toContain('<img');
    expect(detail.budgetRaw).toBeNull();
    expect(detail.publishedAt).toBe('2026-10-09T00:00:00.000Z');
  });

  it('rejects invalid feed payloads rather than reporting empty results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"foo":1}', { status: 200 })));
    const source = new RssAppSource(buildTestConfig({ RSS_FEED_URL: 'https://rss.app/feeds/v1.1/example.json' }));
    await expect(source.discoverProjects({ maxListingPages: 1 })).rejects.toThrow('no items array');
  });
});
