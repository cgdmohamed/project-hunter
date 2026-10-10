import type { AppConfig } from '../config/env.js';
import {
  budgetToUsd,
  parseBudgetText,
  type BudgetInfo,
  type BudgetUsd,
} from '../utils/money.js';
import { contentHash } from '../utils/hash.js';
import { cleanLines, cleanText, sanitizeProjectText } from '../utils/text.js';
import type { ParsedProjectDetail } from '../sources/mostaql/detail.parser.js';
import type { NormalizedProject, DiscoveredProject } from '../types/project.js';

export interface DetailWithBudget extends NormalizedProject {
  budgetInfo: BudgetInfo;
  budgetUsd: BudgetUsd;
}

export class NormalizationService {
  constructor(private readonly config: AppConfig) {}

  buildFromListing(listing: DiscoveredProject): {
    canonicalUrl: string;
    externalId: string;
    contentHash: string;
  } {
    const contentHashValue = contentHash({
      canonicalUrl: listing.canonicalUrl,
      title: listing.title,
    });
    return {
      canonicalUrl: listing.canonicalUrl,
      externalId: listing.externalId,
      contentHash: contentHashValue,
    };
  }

  /**
   * Normalises a parsed detail page into a persisted project shape. Missing
   * fields are null; nothing is invented.
   */
  buildFromDetail(
    source: string,
    externalId: string,
    canonicalUrl: string,
    detail: ParsedProjectDetail,
  ): DetailWithBudget {
    const budget = parseBudgetText(detail.budgetRaw ?? '');
    const budgetUsd = budgetToUsd(budget, this.config.BUDGET_USD_RATES);

    const skills = detail.skills && detail.skills.length > 0 ? detail.skills : null;

    const title = sanitizeProjectText(detail.title);
    const description = sanitizeProjectText(detail.description);
    const category = sanitizeProjectText(detail.category);
    const duration = sanitizeProjectText(detail.expectedDuration);
    const status = sanitizeProjectText(detail.projectStatus);

    const normalized: NormalizedProject = {
      source,
      externalId,
      canonicalUrl,
      title,
      description,
      category,
      skills,
      originalCurrency: budget.currency,
      budgetMin: budget.min,
      budgetMax: budget.max,
      budgetMinUsd: budgetUsd.minUsd,
      budgetMaxUsd: budgetUsd.maxUsd,
      publishedAt: detail.publishedAt,
      expectedDuration: duration,
      projectStatus: status,
      proposalCount: detail.proposalCount,
      contentHash: contentHash({
        title,
        description,
        category,
        skills: skills?.join(', '),
        budgetMin: budget.min,
        budgetMax: budget.max,
        currency: budget.currency,
        publishedAt: detail.publishedAt,
        duration,
        status,
        proposalCount: detail.proposalCount,
      }),
    };

    if (budgetUsd.convertible === false) {
      normalized.originalCurrency = budget.currency ?? null;
    }

    return { ...normalized, budgetInfo: budget, budgetUsd };
  }

  displayBudget(project: {
    budgetMin: number | null;
    budgetMax: number | null;
    originalCurrency: string | null;
    budgetMinUsd: number | null;
    budgetMaxUsd: number | null;
  }): string {
    if (project.budgetMin === null && project.budgetMax === null) {
      return 'غير محددة / مفتوحة (needs_review)';
    }
    const currency = project.originalCurrency ?? 'USD';
    const min = project.budgetMin ?? project.budgetMax;
    const max = project.budgetMax ?? project.budgetMin;
    const usd = project.budgetMaxUsd ?? project.budgetMinUsd;
    return `${min} - ${max} ${currency}${usd !== null ? ` (≈ $${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD)` : ''}`;
  }

  cleanTitle(value: string | null): string | null {
    return cleanText(value);
  }

  lineBreak(value: string | null): string | null {
    return cleanLines(value);
  }
}