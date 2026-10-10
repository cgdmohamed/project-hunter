import type { DiscoveredProject, ListingParseResult } from '../types/project.js';
import type { ParsedProjectDetail } from './mostaql/detail.parser.js';

export interface SourceScanContext {
  /** Maximum listing pages to fetch this scan. */
  maxListingPages: number;
}

/**
 * A pluggable project source. Every source (only Mostaql for the MVP) implements
 * this interface so discovery and detail extraction stay decoupled.
 */
export interface ProjectSource {
  readonly name: string;

  /** Discovers project links across listing pages. */
  discoverProjects(context: SourceScanContext): Promise<ListingParseResult[]>;

  /** Fetches and parses one project detail page. */
  fetchProjectDetail(canonicalUrl: string): Promise<ParsedProjectDetail>;

  /** Verifies that automated access is permitted (robots.txt + reachability). */
  checkAccess(): Promise<SourceAccessStatus>;
}

export interface SourceAccessStatus {
  reachable: boolean;
  status: number | null;
  robotsAllowsListing: boolean | null;
  robotsRaw: string | null;
  notes: string[];
}

export type { DiscoveredProject };