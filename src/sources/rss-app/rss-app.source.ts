import type { AppConfig } from '../../config/env.js';
import type { DiscoveredProject, ListingParseResult } from '../../types/project.js';
import type { ProjectSource, SourceAccessStatus, SourceScanContext } from '../project-source.interface.js';
import type { ParsedProjectDetail } from '../mostaql/detail.parser.js';
import { createHash } from 'node:crypto';
import { cleanText } from '../../utils/text.js';

type Item = { id?: unknown; url?: unknown; title?: unknown; summary?: unknown; content_text?: unknown; content_html?: unknown; description_text?: unknown; date_published?: unknown; date_modified?: unknown };
const asString = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;

/** Reads RSS.app's published JSON Feed, without querying Mostaql. */
export class RssAppSource implements ProjectSource {
  readonly name = 'mostaql';
  private items = new Map<string, Item>();
  constructor(private readonly config: AppConfig) {}

  private projectUrl(item: Item): string | null {
    const candidate = asString(item.url) ?? asString(item.id);
    if (!candidate) return null;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' || !['mostaql.com', 'www.mostaql.com'].includes(url.hostname)) return null;
      if (!/^\/projects?\/[^/]+/.test(url.pathname)) return null;
      url.search = ''; url.hash = '';
      return url.toString();
    } catch { return null; }
  }

  async discoverProjects(_context: SourceScanContext): Promise<ListingParseResult[]> {
    const feed = new URL(this.config.RSS_FEED_URL!);
    if (feed.protocol !== 'https:' || feed.hostname !== 'rss.app') throw new Error('RSS_FEED_URL must be an rss.app HTTPS feed');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(feed, { signal: controller.signal, headers: { accept: 'application/feed+json, application/json' } });
      if (!response.ok) throw new Error(`RSS.app returned HTTP ${response.status}`);
      const payload = await response.json() as { items?: unknown };
      if (!Array.isArray(payload.items)) throw new Error('RSS.app JSON feed has no items array');
      this.items.clear();
      const found: DiscoveredProject[] = [];
      for (const raw of payload.items) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Item;
        const canonicalUrl = this.projectUrl(item);
        if (!canonicalUrl) continue;
        const externalId = canonicalUrl;
        const title = asString(item.title);
        const description = asString(item.description_text) ?? asString(item.content_text) ?? asString(item.summary);
        this.items.set(externalId, item);
        found.push({
          externalId,
          canonicalUrl,
          title,
          listingFingerprint: createHash('sha256').update(JSON.stringify([title, description, item.date_modified ?? item.date_published])).digest('hex'),
        });
      }
      return [{ page: 1, items: found, rawLinksFound: found.length }];
    } finally { clearTimeout(timer); }
  }

  async fetchProjectDetail(canonicalUrl: string): Promise<ParsedProjectDetail> {
    const item = this.items.get(canonicalUrl);
    if (!item) throw new Error('Project detail not present in the latest RSS feed; no direct-site fallback');
    const description = asString(item.description_text) ?? asString(item.content_text) ?? asString(item.summary);
    const title = asString(item.title);
    const publishedAt = asString(item.date_published);
    // Do not infer budgets from arbitrary descriptions: unknown remains needs_review.
    return {
      title, description, category: null, skills: null, budgetRaw: null,
      proposalCount: null, publishedAt, expectedDuration: null, projectStatus: null,
      structure: { title: title !== null, description: description !== null, budget: false },
    };
  }

  async checkAccess(): Promise<SourceAccessStatus> {
    return { reachable: Boolean(this.config.RSS_FEED_URL), status: null, robotsAllowsListing: null, robotsRaw: null, notes: ['RSS.app feed only; no direct Mostaql requests'] };
  }
}
