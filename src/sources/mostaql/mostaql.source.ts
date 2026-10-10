import type { AppConfig } from '../../config/env.js';
import { BlockedAccessError, type HttpFetcher } from '../../integrations/http.js';
import type { ListingParseResult } from '../../types/project.js';
import type { DiscoveredProject, SourceAccessStatus, SourceScanContext, ProjectSource } from '../project-source.interface.js';
import { parseListingPage } from './listing.parser.js';
import { parseProjectDetail } from './detail.parser.js';

export class MostaqlSource implements ProjectSource {
  readonly name = 'mostaql';
  private robotsCheckedAt = 0;
  private robotsRawCache: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly http: HttpFetcher,
  ) {}

  private get baseUrl(): string {
    return this.config.MOSTAQL_BASE_URL;
  }

  async discoverProjects(context: SourceScanContext): Promise<ListingParseResult[]> {
    await this.ensureRobotsPermission();
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
    await this.ensureRobotsPermission();
    if (!robotsAllowProjects(this.robotsRawCache ?? '', new URL(canonicalUrl).pathname, this.config.MOSTAQL_USER_AGENT)) {
      throw new BlockedAccessError('robots', null, 'robots.txt disallows this project detail path');
    }
    const result = await this.http.fetchHtml(canonicalUrl);
    return parseProjectDetail(result.text, this.baseUrl, this.config.SELECTORS);
  }

  async checkAccess(): Promise<SourceAccessStatus> {
    const notes: string[] = [];
    const robotsRaw = await this.fetchRobotsTxt();
    let robotsAllowsListing: boolean | null = null;
    if (robotsRaw !== null) {
      robotsAllowsListing = robotsAllowProjects(robotsRaw, '/projects', this.config.MOSTAQL_USER_AGENT);
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
      if (robotsAllowsListing !== true) throw new Error('Skipping listing probe: robots permission not established');
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

  private async ensureRobotsPermission(): Promise<void> {
    if (Date.now() - this.robotsCheckedAt < 3_600_000 && this.robotsRawCache !== null) return;
    const raw = await this.fetchRobotsTxt();
    if (raw === null) throw new BlockedAccessError('robots', null, 'Unable to verify robots.txt; scraping paused for manual review');
    this.robotsRawCache = raw;
    this.robotsCheckedAt = Date.now();
    if (!robotsAllowProjects(raw, '/projects', this.config.MOSTAQL_USER_AGENT)) {
      throw new BlockedAccessError('robots', null, 'robots.txt disallows automated project listings access');
    }
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

/**
 * RFC 9309-style group selection and longest-path rule precedence.
 * Unknown rules are ignored; exact longest-match ties favor Allow.
 */
export function robotsAllowProjects(raw: string, path = '/projects', userAgent = 'ProjectHunterBot'): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let agents: string[] = [];
  let rules: Group['rules'] = [];
  const flush = (): void => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    const withoutComment = line.split('#')[0]!.trim();
    if (!withoutComment) continue;
    const colon = withoutComment.indexOf(':');
    if (colon < 0) continue;
    const key = withoutComment.slice(0, colon).trim().toLowerCase();
    const value = withoutComment.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && agents.length) {
      if (value !== '') rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  flush();

  const agent = userAgent.toLowerCase();
  let specificity = -1;
  for (const group of groups) {
    for (const candidate of group.agents) {
      if (candidate === '*' || agent.includes(candidate)) specificity = Math.max(specificity, candidate === '*' ? 0 : candidate.length);
    }
  }
  if (specificity < 0) return true;
  const selected = groups.filter(group => group.agents.some(candidate =>
    specificity === 0 ? candidate === '*' : candidate !== '*' && candidate.length === specificity && agent.includes(candidate),
  ));
  let best = -1;
  let permitted = true;
  for (const group of selected) {
    for (const rule of group.rules) {
      const escaped = rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      const regex = new RegExp('^' + escaped.replace(/\\\$$/, '$'));
      if (!regex.test(path)) continue;
      const length = rule.pattern.replace(/[\*$]/g, '').length;
      if (length > best || (length === best && rule.allow)) {
        best = length;
        permitted = rule.allow;
      }
    }
  }
  return permitted;
}

export type { DiscoveredProject };
