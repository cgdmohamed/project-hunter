import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { Metrics } from '../utils/metrics.js';
import type { DiscoveredProject } from '../types/project.js';
import type { ProjectSource } from '../sources/project-source.interface.js';
import type { NormalizationService } from './normalization.service.js';
import type { ProjectRepository } from './project.repository.js';
import type { ScraperHealthService } from './scraper-health.service.js';

export interface DiscoveryResult {
  totalListed: number;
  newCount: number;
  duplicateCount: number;
  /** IDs of projects that need (re)fetching detail (new or listing changed). */
  projectIdsNeedingDetail: number[];
  structureMismatch: boolean;
}

export class DiscoveryService {
  constructor(
    private readonly source: ProjectSource,
    private readonly repo: ProjectRepository,
    private readonly normalization: NormalizationService,
    private readonly health: ScraperHealthService,
    private readonly metrics: Metrics,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Discovers projects from listing pages and upserts them. Detail pages are not
   * fetched here; the caller decides which need detail work.
   */
  async discover(): Promise<DiscoveryResult> {
    const pages = await this.source.discoverProjects({
      maxListingPages: this.config.SCRAPER_MAX_LISTING_PAGES,
    });

    const seen = new Map<string, DiscoveredProject>();
    let rawLinks = 0;
    for (const page of pages) {
      rawLinks += page.rawLinksFound;
      for (const item of page.items) {
        if (!seen.has(item.externalId)) seen.set(item.externalId, item);
      }
    }

    const structureMismatch = rawLinks === 0;
    if (structureMismatch) {
      this.health.recordStructureMismatch();
      this.metrics.structureMismatches = this.health.structureMismatchCount();
      this.logger.warn('listing page yielded zero project links — possible structure change');
    } else {
      this.health.resetStructureMismatch();
    }

    const projectIdsNeedingDetail: number[] = [];
    let newCount = 0;
    let duplicateCount = 0;

    for (const item of seen.values()) {
      const existing = this.repo.findBySourceExternalId(this.source.name, item.externalId);
      if (!existing) {
        const listing = this.normalization.buildFromListing(item);
        const inserted = this.repo.insertDiscovered({
          source: this.source.name,
          externalId: item.externalId,
          canonicalUrl: listing.canonicalUrl,
          title: item.title,
          listingFingerprint: item.listingFingerprint,
          contentHash: listing.contentHash,
        });
        projectIdsNeedingDetail.push(inserted.id);
        newCount += 1;
        continue;
      }

      const drift = existing.listingFingerprint !== item.listingFingerprint;
      this.repo.touchFromListing(existing.id, {
        title: item.title ?? existing.title,
        listingFingerprint: item.listingFingerprint,
        lastSeenAt: new Date().toISOString(),
      });
      duplicateCount += 1;

      const needsDetail =
        drift || existing.detailFetchedAt === null || this.isDetailStale(existing.detailFetchedAt);
      if (needsDetail) projectIdsNeedingDetail.push(existing.id);
    }

    this.metrics.projectsDiscovered += seen.size;
    this.metrics.projectsNew += newCount;
    this.metrics.projectsDuplicate += duplicateCount;

    this.logger.info(
      { listed: seen.size, newCount, duplicateCount, needDetail: projectIdsNeedingDetail.length, structureMismatch },
      'discovery completed',
    );

    return {
      totalListed: seen.size,
      newCount,
      duplicateCount,
      projectIdsNeedingDetail,
      structureMismatch,
    };
  }

  /** True when a project's detail page should be re-fetched for freshness. */
  private isDetailStale(detailFetchedAt: string | null): boolean {
    if (this.config.SCRAPER_DETAIL_REFRESH_HOURS <= 0) return true;
    if (detailFetchedAt === null) return true;
    const ageMs = Date.now() - new Date(detailFetchedAt).getTime();
    return ageMs >= this.config.SCRAPER_DETAIL_REFRESH_HOURS * 3_600_000;
  }
}