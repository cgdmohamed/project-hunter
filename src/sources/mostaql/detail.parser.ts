import * as cheerio from 'cheerio';
import type { MostaqlSelectors } from '../../config/selectors.js';
import { parseBudgetText } from '../../utils/money.js';
import { parsePublishedAt } from '../../utils/date.js';
import { cleanLines, cleanText, isBlank } from '../../utils/text.js';

export interface ParsedProjectDetail {
  title: string | null;
  description: string | null;
  category: string | null;
  skills: string[] | null;
  budgetRaw: string | null;
  proposalCount: number | null;
  publishedAt: string | null;
  expectedDuration: string | null;
  projectStatus: string | null;
  /** Tracks which key signals were actually found — used for structure-change monitoring. */
  structure: {
    title: boolean;
    description: boolean;
    budget: boolean;
  };
}

/**
 * Best-effort detail parser. Missing fields are reported as null rather than
 * guessed. Uses configurable selectors first and conservative regex fallbacks
 * second (title heading, budget/money patterns, meta descriptions).
 */
export function parseProjectDetail(
  html: string,
  baseUrl: string,
  selectors: MostaqlSelectors,
): ParsedProjectDetail {
  const $ = cheerio.load(html);
  const sourceUrl = $('link[rel="canonical"]').attr('href') ?? baseUrl;
  void sourceUrl;

  const pickText = (candidates: string[]): string | null => {
    for (const selector of candidates) {
      const found = $(selector).first();
      if (found.length > 0) {
        const text = cleanText(found.text());
        if (text !== null) return text;
      }
    }
    return null;
  };

  const title =
    pickText(selectors.detail.title) ??
    cleanText($('meta[property="og:title"]').attr('content')) ??
    null;

  let description: string | null = pickText(selectors.detail.description);
  if (description === null) {
    description =
      cleanText($('meta[name="description"]').attr('content')) ??
      cleanText($('meta[property="og:description"]').attr('content')) ??
      null;
  }
  description = description === null ? null : cleanLines(description);

  const category =
    pickText(selectors.detail.category) ??
    cleanText($('meta[property="og:type"]').attr('content')) ??
    null;

  const skillsRaw: string[] = [];
  for (const selector of selectors.detail.skills) {
    $(selector).each((_, el) => {
      const text = cleanText($(el).text());
      if (text !== null) skillsRaw.push(text);
    });
  }
  const skills = [...new Set(skillsRaw)].length > 0 ? [...new Set(skillsRaw)] : null;

  let budgetRaw: string | null = pickText(selectors.detail.budget) ?? pickText(['[data-testid*="udget"]'] as string[]);
  if (budgetRaw === null) {
    budgetRaw = extractBudgetFromBody($);
  }
  const budgetText = budgetRaw ?? '';

  const proposalCountText =
    pickText(selectors.detail.proposalCount) ??
    cleanText($('[data-testid*="roposal"]').first().text()) ??
    null;
  const proposalCount = parseCount(proposalCountText);

  const publishedAtRaw =
    cleanText($('time').attr('datetime')) ??
    cleanText($('meta[property="article:published_time"]').attr('content')) ??
    pickText(selectors.detail.publishedAt) ??
    null;
  const publishedAt = parsePublishedAt(publishedAtRaw ?? '') ?? null;

  const expectedDuration =
    pickText(selectors.detail.duration) ?? extractDurationFromBody($) ?? null;

  const projectStatus =
    normalizeStatus(pickText(selectors.detail.status)) ?? extractStatusFromBody($) ?? null;

  const budget = parseBudgetText(budgetText);

  return {
    title,
    description,
    category,
    skills,
    budgetRaw: budgetRaw === null ? null : budgetText,
    proposalCount,
    publishedAt,
    expectedDuration,
    projectStatus,
    structure: {
      title: title !== null,
      description: description !== null,
      budget: budgetRaw !== null,
    },
  };
}

function parseCount(text: string | null): number | null {
  if (text === null) return null;
  const matches = text.match(/\d+/g);
  if (!matches) return null;
  const value = Number(matches[0]);
  return Number.isFinite(value) ? value : null;
}

function extractBudgetFromBody($: cheerio.CheerioAPI): string | null {
  const text = $('body').text();
  const budgetLabel = text.match(/الميزانية[^\n]{0,120}/i);
  if (budgetLabel) {
    const cleaned = cleanText(budgetLabel[0]);
    if (cleaned !== null && /[\d]/.test(cleaned)) return cleaned;
  }
  const moneyMatch = text.match(/\$\s*[\d.,]+|[\d.,]+\s*\$|[\d.,]+\s*(?:ر\.?س|د\.?إ|جنيه|درهم|دينار|ريال)/);
  if (moneyMatch) return cleanText(moneyMatch[0]);
  return null;
}

function extractDurationFromBody($: cheerio.CheerioAPI): string | null {
  const text = $('body').text();
  const match = text.match(/(?:مدة\s*(?:التنفيذ|التسليم)?|التنفيذ)[^\n]{0,60}/i);
  if (!match) return null;
  const cleaned = cleanText(match[0]);
  return isBlank(cleaned) ? null : cleaned;
}

function normalizeStatus(value: string | null): string | null {
  if (!value) return null;
  if (/مغلق|منتهي|انتهى|مكتمل|complete|closed/i.test(value)) return 'closed';
  if (/مفتوح|متاح|open/i.test(value)) return 'open';
  return null;
}

function extractStatusFromBody($: cheerio.CheerioAPI): string | null {
  return normalizeStatus($('body').text());
}

export function extractProposalUrl(canonicalUrl: string): string {
  return canonicalUrl.replace(/\/project\//, '/projects/');
}