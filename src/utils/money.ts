import { normalizeDigits } from './date.js';

export interface BudgetInfo {
  min: number | null;
  max: number | null;
  currency: string | null;
  /** True when the listing advertises an open/negotiable budget. */
  openBudget: boolean;
  /** The original raw budget text, for transparency. */
  raw: string;
}

const NUMBER_RE = /(\d[\d.,\u066B\u066C\u0660-\u0669\u06F0-\u06F9]*)/g;

// Ordered currency matchers: more specific patterns first.
const CURRENCY_RULES: Array<{ code: string; patterns: RegExp[] }> = [
  { code: 'SAR', patterns: [/ريال\s*(?:سعودي)|ر\.?\s?س|سد|(?:sar)/i] },
  { code: 'AED', patterns: [/درهم\s*(?:اماراتي)?|د\.?\s?إ|د\.?\s?ا|(?:aed)/i] },
  { code: 'JOD', patterns: [/دينار\s*(?:اردني|أردني)|د\.?\s?أ|(?:jod)/i] },
  { code: 'KWD', patterns: [/دينار\s*(?:كويتي)|د\.?\s?ك|(?:kwd)/i] },
  { code: 'BHD', patterns: [/دينار\s*(?:بحريني)|د\.?\s?ب|(?:bhd)/i] },
  { code: 'QAR', patterns: [/ريال\s*(?:قطري)|ر\.?\s?ق|(?:qar)/i] },
  { code: 'OMR', patterns: [/ريال\s*(?:عماني)|ر\.?\s?ع|(?:omr)/i] },
  { code: 'EGP', patterns: [/جنيه|ج\.?\s?م|(?:egp)/i] },
  { code: 'USD', patterns: [/\$\s?(?:usd)?|(?:usd)|دولار|د\.?\s?أمريكي/i] },
  { code: 'EUR', patterns: [/€|يورو|(?:eur)/i] },
  { code: 'GBP', patterns: [/£|جنيه\s*(?:استرليني|إسترليني)|(?:gbp)/i] },
];

const OPEN_BUDGET_MARKERS = [
  /الميزانية\s+مفتوحة/i,
  /ميزانية\s+مفتوحة/i,
  /بصرف\s+النظر\s+عن\s+الميزانية/i,
  /open\s+budget/i,
  /budget\s+is\s+open/i,
  /حسب\s+الاتفاق/i,
];

export function detectCurrency(text: string): string | null {
  for (const rule of CURRENCY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) return rule.code;
    }
  }
  return null;
}

function extractNumbers(text: string): number[] {
  const normalized = normalizeDigits(text);
  const numbers: number[] = [];
  for (const match of normalized.matchAll(NUMBER_RE)) {
    const raw = match[1];
    if (!raw) continue;
    const cleaned = raw
      .replace(/[,\u066C\u060C\s]/g, '')
      .replace(/\u066B/g, '.');
    const value = parseFloat(cleaned);
    if (Number.isFinite(value) && value >= 0) {
      numbers.push(value);
    }
  }
  return numbers;
}

export function isOpenBudgetText(text: string): boolean {
  return OPEN_BUDGET_MARKERS.some((marker) => marker.test(text));
}

/**
 * Parses a raw budget string into a min/max/currency triple.
 * Never invents values: anything ambiguous is left null.
 */
export function parseBudgetText(rawText: string | null | undefined): BudgetInfo {
  const raw = (rawText ?? '').trim();
  const result: BudgetInfo = {
    min: null,
    max: null,
    currency: null,
    openBudget: false,
    raw,
  };
  if (raw === '') return result;

  result.currency = detectCurrency(raw);
  result.openBudget = isOpenBudgetText(raw);
  if (result.openBudget) return result;

  const numbers = extractNumbers(raw);
  if (numbers.length === 0) return result;

  const hasUpperBound = /أقل\s*من|اقل\s*من|less\s+than|max\s+|حد\s+أقصى|up\s+to|<=|<|حد اقصى/i.test(raw);
  const hasLowerBound = /أعلى\s*من|اعلى\s*من|more\s+than|min\s+|حد\s+أدنى|at\s+least|>=|>|حد ادنى/i.test(raw);

  const lo = Math.min(...numbers);
  const hi = Math.max(...numbers);

  if (numbers.length === 1) {
    const single = numbers[0] as number;
    if (hasUpperBound) {
      result.max = single;
    } else if (hasLowerBound) {
      result.min = single;
    } else {
      // A single amount is treated as a confirmed exact budget.
      result.min = single;
      result.max = single;
    }
    return result;
  }

  result.min = lo;
  result.max = hi;
  return result;
}

export function toUsd(value: number | null, currency: string | null, rates: Record<string, number>): number | null {
  if (value === null || value === undefined) return null;
  const code = currency ?? 'USD';
  const rate = rates[code.toUpperCase()];
  if (!rate) return null;
  return round2(value * rate);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface BudgetUsd {
  minUsd: number | null;
  maxUsd: number | null;
  /** False when the budget is present but cannot be converted to USD. */
  convertible: boolean;
}

export function budgetToUsd(budget: BudgetInfo, rates: Record<string, number>): BudgetUsd {
  if ((budget.min === null && budget.max === null) || budget.openBudget) {
    return { minUsd: null, maxUsd: null, convertible: true };
  }
  // Without a recognisable currency we refuse to assume one (never invent rates).
  if (budget.currency === null) {
    return { minUsd: null, maxUsd: null, convertible: false };
  }
  const rate = rates[budget.currency.toUpperCase()];
  if (!rate) {
    return { minUsd: null, maxUsd: null, convertible: false };
  }
  const minUsd = budget.min === null ? null : round2(budget.min * rate);
  const maxUsd = budget.max === null ? null : round2(budget.max * rate);
  return { minUsd, maxUsd, convertible: true };
}

export type BudgetDecision = 'eligible' | 'rejected' | 'needs_review';

/**
 * Filtering rules from the specification:
 * - A confirmed maximum below the threshold => rejected.
 * - A range overlapping or exceeding the threshold => eligible.
 * - Unknown budget => needs_review (never auto-notified as a confirmed match).
 */
export function evaluateBudget(
  budgetUsd: BudgetUsd,
  thresholdUsd: number,
): BudgetDecision {
  if (!budgetUsd.convertible) return 'needs_review';
  if (budgetUsd.maxUsd === null && budgetUsd.minUsd === null) return 'needs_review';
  if (budgetUsd.maxUsd !== null && budgetUsd.maxUsd < thresholdUsd) return 'rejected';
  return 'eligible';
}