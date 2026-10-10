import * as cheerio from 'cheerio';
import type { MostaqlSelectors } from '../../config/selectors.js';
import type { DiscoveredProject, ListingParseResult } from '../../types/project.js';
import { cleanText } from '../../utils/text.js';
import { fingerprint } from '../../utils/hash.js';
import {
  canonicalProjectUrl,
  extractProjectIdFromUrl,
  isSameOrigin,
  resolveUrl,
} from '../../utils/urls.js';

const RESERVED_PROJECT_PATH_SEGMENTS = new Set(['search', 'create', 'new', 'publish', 'edit', 'reports']);

/**
 * Parses a Mostaql listing page and extracts project links.
 *
 * The default selector is a URL-based rule (`a[href*="/project/"]`) which is far
 * more resilient to markup churn than generated class names. Callers may supply
 * an override through MOSTAQL_SELECTORS.
 */
export function parseListingPage(
  html: string,
  baseUrl: string,
  selectors: MostaqlSelectors,
  page = 1,
): ListingParseResult {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items: DiscoveredProject[] = [];
  let rawLinksFound = 0;

  $(selectors.listing.rows).each((_, element) => {
    const el = $(element);
    const href = el.attr('href') ?? null;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved || !isSameOrigin(resolved, baseUrl)) return;

    const externalId = extractProjectIdFromUrl(resolved);
    if (!externalId || seen.has(externalId)) return;
    if (RESERVED_PROJECT_PATH_SEGMENTS.has(externalId)) return;
    rawLinksFound += 1;

    const canonicalUrl = canonicalProjectUrl(resolved);
    const titleElement = el.find('h1, h2, h3, h4, .title, .project-title, .project__title').first();
    const title = cleanText(titleElement.length > 0 ? titleElement.text() : el.text());

    // A lightweight fingerprint built from listing data so we can detect when a
    // project's visible summary changed and only then re-fetch its detail page.
    const snippet = cleanText(el.closest('li, article, .project-card, .card').text()) ?? '';
    const listingFingerprint = fingerprint({ title, snippet: snippet.slice(0, 400) });

    seen.add(externalId);
    items.push({ externalId, canonicalUrl, title, listingFingerprint });
  });

  return { items, rawLinksFound, page };
}