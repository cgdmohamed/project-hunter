/**
 * Default CSS selectors for the Mostaql source.
 *
 * Selectors are intentionally centralised here so that structural changes to
 * mostaql.com can be accommodated through the MOSTAQL_SELECTORS environment
 * variable instead of editing code scattered across the parser.
 *
 * Each detail field is an ordered list of candidate selectors: the parser tries
 * them in order and uses the first one that yields a value.
 */
export interface MostaqlSelectors {
  listing: {
    rows: string;
  };
  detail: {
    title: string[];
    description: string[];
    category: string[];
    skills: string[];
    budget: string[];
    proposalCount: string[];
    publishedAt: string[];
    duration: string[];
    status: string[];
  };
}

export const DEFAULT_SELECTORS: MostaqlSelectors = {
  listing: {
    rows: 'a[href*="/project/"]',
  },
  detail: {
    title: ['h1', '.project-header h1', '.single-project-content h1'],
    description: [
      '.project-details .description',
      '.single-project-description',
      '.project-description',
      '[data-testid="project-description"]',
      '.card-body',
      '#project-brief',
    ],
    category: [
      '.project-category a',
      '.breadcrumb li:last-child a',
      'a[href*="/projects/"]',
    ],
    skills: [
      '.project-skills a',
      '.project-skills li',
      '.skills a',
      '.skills li',
      '.project-tags a',
      '.tags a',
      '[data-testid="project-skills"] a',
      '[data-testid="project-skills"] li',
      '.single-project-skills a',
    ],
    budget: [
      '.project-budget',
      '.single-project-budget',
      '[data-testid="project-budget"]',
      '.project-price',
      '.budget',
    ],
    proposalCount: [
      '.project-proposals-count',
      '.offers-count',
      '.proposals-count',
      '.bids-count',
      '[data-testid="proposal-count"]',
    ],
    publishedAt: [
      'time[datetime]',
      '.project-published time',
      '[data-testid="project-published"]',
    ],
    duration: [
      '.project-duration',
      '.expected-duration',
      '[data-testid="project-duration"]',
    ],
    status: [
      '.project-status',
      '.project-state',
      '[data-testid="project-status"]',
    ],
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override) || !isPlainObject(base)) {
    return (override === undefined ? base : (override as T));
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const current = (base as Record<string, unknown>)[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export function buildSelectors(rawOverride?: string): MostaqlSelectors {
  if (!rawOverride || rawOverride.trim() === '') {
    return DEFAULT_SELECTORS;
  }
  const parsed = JSON.parse(rawOverride) as unknown;
  return deepMerge(DEFAULT_SELECTORS, parsed);
}
