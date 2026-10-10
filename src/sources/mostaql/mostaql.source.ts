import type { AppConfig } from '../../config/env.js';
import type { HttpFetcher } from '../../integrations/http.js';
import type { ListingParseResult } from '../../types/project.js';
import type { DiscoveredProject, SourceAccessStatus, SourceScanContext, ProjectSource } from '../project-source.interface.js';
import { parseListingPage } from './listing.parser.js';
import { parseProjectDetail } from './detail.parser.js';

export class MostaqlSource implements ProjectSource {
  readonly name = 'mostaql';

  constructor(
    private readonly config: AppConfig,
    private readonly http: HttpFetcher,
  ) {}

  private get baseUrl(): string {
    return this.config.MOSTAQL_BASE_URL;
  }

  async discoverProjects(context: SourceScanContext): Promise<ListingParseResult[]> {
    const pages: ListingParseResult[] = [];
    for (let page = 1; page <= context.maxListingPages; page += 1) {
      const url = `${this.baseUrl}/projects${page === 1 ? '' : `?page=${page}`}`;
      const result = await this.http.fetchHtml(url);
      const parsed = parseListingPage(result.text, this.baseUrl, this.config.SELECTORS, page);
      pages.push(parsed);
    }
    return pages;
  }

  async fetchProjectDetail(canonicalUrl: string): Promise<ReturnType<typeof parseProjectDetail>> {
    const result = await this.http.fetchHtml(canonicalUrl);
    return parseProjectDetail(result.text, this.baseUrl, this.config.SELECTORS);
  }

  async checkAccess(): Promise<SourceAccessStatus> {
    const notes: string[] = [];
    const robotsRaw = await this.fetchRobotsTxt();
    let robotsAllowsListing: boolean | null = null;
    if (robotsRaw !== null) {
      robotsAllowsListing = robotsAllowProjects(robotsRaw);
      notes.push(
        robotsAllowsListing
          ? 'robots.txt allows listing access'
          : 'robots.txt disallows automated listing access',
      );
    } else {
      notes.push('no robots.txt found (or not reachable)');
    }

    let reachable = false;
    let status: number | null = null;
    try {
      const listing = await this.http.fetchHtml(`${this.baseUrl}/projects`);
      status = listing.status;
      reachable = true;
      notes.push(`MPV: listing page reachable (HTTP ${status})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`MPV: listing page check failed — ${message}`);
    }

    return {
      reachable,
      status,
      robotsAllowsListing,
      robotsRaw,
      notes,
    };
  }

  private async fetchRobotsTxt(): Promise<string | null> {
    try {
      // robots.txt is fetched without politeness delay to avoid skewing metrics.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`${this.baseUrl}/robots.txt`, {
          signal: controller.signal,
          headers: { 'user-agent': this.config.MOSTAQL_USER_AGENT },
        });
        if (!response.ok) return null;
        return (await response.text()).slice(0, 10_000);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }
}

export function robotsAllowProjects(raw: string): boolean {
  const lines = raw.split(/\r?\n/);
  let inUserAgentStar = false;
  let sawRules = false;
  let disallowsRoot = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const [keyRaw, ...valueParts] = trimmed.split(':');
    const key = keyRaw?.trim().toLowerCase();
    const value = valueParts.join(':').trim();
    if (!key) continue;
    sawRules = true;

    if (key === 'user-agent') {
      inUserAgentStar = value === '*' || value.toLowerCase().includes('bot');
      continue;
    }
    if (!inUserAgentStar) continue;

    if (key === 'disallow') {
      if (value === '' || value === '/') {
        disallowsRoot = true;
      } else if (value.startsWith('/projects')) {
        disallowsRoot = true;
      }
    } else if (key === 'allow') {
      if (value.startsWith('/projects')) {
        disallowsRoot = false;
      }
    }
  }

  if (!sawRules) return false;
  return !disallowsRoot;
}

export type { DiscoveredProject };