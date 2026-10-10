export const PROJECT_STATUSES = [
  'discovered',
  'budget_rejected',
  'needs_review',
  'pending_analysis',
  'analyzed',
  'qualified',
  'rejected',
  'notified',
  'notification_failed',
  'manually_applied',
  'archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_TYPES = ['opportunity', 'alert'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Bare listing-page item (no detail fetched yet). */
export interface DiscoveredProject {
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  listingFingerprint: string;
}

export interface ListingParseResult {
  items: DiscoveredProject[];
  /** Number of project-card anchors found on the page. */
  rawLinksFound: number;
  page: number;
}

/** Fully normalised project as persisted during detail processing. */
export interface NormalizedProject {
  source: string;
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  category: string | null;
  skills: string[] | null;
  originalCurrency: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetMinUsd: number | null;
  budgetMaxUsd: number | null;
  publishedAt: string | null;
  expectedDuration: string | null;
  projectStatus: string | null;
  proposalCount: number | null;
  contentHash: string;
}

export interface AnalysisResult {
  score: number;
  category: string;
  summary: string;
  businessProblem: string;
  technicalSuitability: string;
  suitabilityReasons: string[];
  financialViability: string;
  risks: string[];
  missingRequirements: string[];
  clarificationQuestions: string[];
  recommendedApproach: string;
  estimatedDuration: string;
  recommendedPrice: string;
  confidence: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface ProposalResult {
  language: 'ar' | 'en';
  proposalText: string;
  recommendedPrice: string | null;
  estimatedDuration: string | null;
}

export const THRESHOLDS = {
  MAX_CAPABILITY_MATCH: 35,
  MAX_FINANCIAL_VIABILITY: 25,
  MAX_REQUIREMENTS_CLARITY: 15,
  MAX_DELIVERY_FEASIBILITY: 15,
  MAX_RISKS: 10,
  TOTAL: 100,
} as const;