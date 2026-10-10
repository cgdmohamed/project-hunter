import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino, type Logger } from 'pino';
import type { AppConfig } from '../../src/config/env.js';
import { DEFAULT_MOSTAQL_SELECTORS } from '../../src/config/selectors.js';
import type { Container } from '../../src/container.js';
import { buildContainer } from '../../src/container.js';
import { runMigrations } from '../../src/database/client.js';
import { Metrics } from '../../src/utils/metrics.js';
import type { DiscoveredProject } from '../../src/types/project.js';
import type { ParsedProjectDetail } from '../../src/sources/mostaql/detail.parser.js';
import type { ProjectSource } from '../../src/sources/project-source.interface.js';
import type { EvaluationCall, EvaluationResponse, ProposalCall } from '../../src/integrations/openai.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function fixturesDir(): string {
  return resolve(__dirname, '..', 'fixtures');
}

export function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir(), name), 'utf8');
}

export function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 0,
    LOG_LEVEL: 'silent',
    SCAN_INTERVAL_MINUTES: 30,
    SCAN_ON_STARTUP: false,
    AUTO_SCAN_ENABLED: false,
    MIN_PROJECT_BUDGET_USD: 100,
    MIN_PROJECT_SCORE: 75,
    MOSTAQL_BASE_URL: 'https://mostaql.com',
    SCRAPER_ENABLED: true,
    SCRAPER_REQUEST_TIMEOUT_MS: 5000,
    SCRAPER_REQUEST_DELAY_MS: 0,
    SCRAPER_MAX_CONCURRENCY: 1,
    SCRAPER_MAX_LISTING_PAGES: 1,
    SCRAPER_RETRY_MAX: 3,
    SCRAPER_STRUCTURE_MISMATCH_ALERT_THRESHOLD: 3,
    SCRAPER_DETAIL_REFRESH_HOURS: 24,
    MOSTAQL_USER_AGENT: 'ProjectHunterTest/1.0',
    PLAYWRIGHT_ENABLED: false,
    DATA_DIR: resolve(__dirname, '..', '.tmp'),
    DATABASE_PATH: ':memory:',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_MODEL: 'test-model',
    OPENAI_REQUEST_TIMEOUT_MS: 30_000,
    OPENAI_MAX_TOKENS: 1000,
    OPENAI_INPUT_PRICE_PER_1M: 0.15,
    OPENAI_OUTPUT_PRICE_PER_1M: 0.6,
    OPENAI_MAX_ANALYSES_PER_SCAN: 10,
    BUDGET_USD_RATES: {
      USD: 1,
      SAR: 0.2667,
      EGP: 0.0204,
      JOD: 1.4102,
    },
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: 'test-chat',
    TELEGRAM_REQUEST_TIMEOUT_MS: 10_000,
    ADMIN_API_KEY: 'test-admin-key',
    ALERT_DEDUP_MINUTES: 60,
    SELECTORS: DEFAULT_MOSTAQL_SELECTORS,
  };
  return { ...base, ...overrides };
}

export function testLogger(): Logger {
  return pino({ level: 'silent' });
}

export interface TestContainerHandle {
  container: Container;
  config: AppConfig;
  metrics: Metrics;
  sendMessages: ReturnType<typeof createFakeTelegram>['sendMessages'];
  sendMessage: ReturnType<typeof createFakeTelegram>['sendMessage'];
  telegram: ReturnType<typeof createFakeTelegram>;
  sentMessages: string[];
  close: () => void;
}

export function createFakeTelegram() {
  const sentMessages: string[] = [];
  let failNext = 0;
  return {
    sentMessages,
    sendMessage: async (html: string) => {
      if (failNext > 0) {
        failNext -= 1;
        throw new Error('telegram simulated failure');
      }
      sentMessages.push(html);
      return { messageId: sentMessages.length + 100 };
    },
    sendMessages: async (messages: string[]) => {
      for (const message of messages) {
        if (failNext > 0) {
          failNext -= 1;
          throw new Error('telegram simulated failure');
        }
        sentMessages.push(message);
      }
      return { messageId: sentMessages.length + 100 };
    },
    setFailNext: (n: number) => {
      failNext = n;
    },
    enabled: true,
  };
}

export function buildTestContainer(overrides: {
  config?: Partial<AppConfig>;
  source?: Container['source'];
  openai?: Container['openai'];
  telegram?: ReturnType<typeof createFakeTelegram>;
} = {}): TestContainerHandle {
  const config = buildTestConfig(overrides.config);
  const logger = testLogger();
  const metrics = new Metrics();
  const fakeTelegram = overrides.telegram ?? createFakeTelegram();

  const container = buildContainer(config, {
    logger,
    metrics,
    databasePath: ':memory:',
    source: overrides.source,
    openai: overrides.openai,
    telegram: fakeTelegram,
  });

  runMigrations(container.sqlite);

  return {
    container,
    config,
    metrics,
    sendMessages: fakeTelegram.sendMessages,
    sendMessage: fakeTelegram.sendMessage,
    telegram: fakeTelegram,
    sentMessages: fakeTelegram.sentMessages,
    close: () => {
      try {
        container.sqlite.close();
      } catch {
        // already closed
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Fake source + fake AI helpers
// ---------------------------------------------------------------------------

export type FakeDetailMap = Record<string, ParsedProjectDetail>;

export function createFakeSource(listing: DiscoveredProject[], details: FakeDetailMap): ProjectSource {
  return {
    name: 'mostaql',
    async discoverProjects() {
      return [{ items: listing, rawLinksFound: listing.length, page: 1 }];
    },
    async fetchProjectDetail(canonicalUrl: string) {
      const id = canonicalUrl.split('/').pop() as string;
      const detail = details[id];
      if (!detail) throw new Error(`no fixture detail for ${id}`);
      return detail;
    },
    async checkAccess() {
      return {
        reachable: true,
        status: 200,
        robotsAllowsListing: true,
        robotsRaw: 'User-agent: *\nAllow: /',
        notes: ['test-source'],
      };
    },
  };
}

export function makeDetail(overrides: Partial<ParsedProjectDetail> = {}): ParsedProjectDetail {
  return {
    title: 'مشروع اختبار',
    description: 'وصف المشروع من أجل الاختبار الآلي.',
    category: 'تطوير ويب',
    skills: ['React'],
    budgetRaw: '$500 - $2,500',
    proposalCount: 3,
    publishedAt: '2025-06-01T10:00:00.000Z',
    expectedDuration: 'أسبوعان',
    projectStatus: 'open',
    structure: { title: true, description: true, budget: true },
    ...overrides,
  };
}

export function makeListing(externalId: string, title: string): DiscoveredProject {
  return {
    externalId,
    canonicalUrl: `https://mostaql.com/project/${externalId}`,
    title,
    listingFingerprint: `${externalId}:${title}`,
  };
}

const defaultEvaluation: EvaluationResponse = {
  category: 'تطوير ويب',
  summary: 'ملخص عربي',
  businessProblem: 'مشكلة العميل',
  technicalSuitability: 'مناسبة',
  relevanceReason: 'تطابق القدرات',
  expectedComplexity: 'medium',
  recommendedApproach: 'React + Node.js',
  financialViabilityComment: 'ميزانية مقبولة',
  risks: ['خطر بسيط'],
  missingRequirements: [],
  clarificationQuestions: [],
  estimatedDuration: 'أسبوعان',
  suggestedBid: '$1,200',
  confidence: 0.9,
  criteria: {
    capabilityMatch: 30,
    financialViability: 20,
    requirementsClarity: 13,
    deliveryFeasibility: 13,
    riskFactor: 9,
  },
  overallScore: 85,
};

export function makeEvaluationCall(overrides: Partial<EvaluationResponse> = {}): EvaluationCall {
  const result = { ...defaultEvaluation, ...overrides };
  if (overrides.criteria) {
    result.criteria = { ...defaultEvaluation.criteria, ...overrides.criteria };
  }
  if (overrides.overallScore === undefined) {
    const { criteria } = result;
    result.overallScore =
      criteria.capabilityMatch +
      criteria.financialViability +
      criteria.requirementsClarity +
      criteria.deliveryFeasibility +
      criteria.riskFactor;
  }
  return { result, inputTokens: 200, outputTokens: 100, estimatedCost: 0.002 };
}

export function makeProposalCall(overrides: Partial<ProposalCall> = {}): ProposalCall {
  return {
    inputTokens: 150,
    outputTokens: 80,
    estimatedCost: 0.001,
    result: {
      language: 'ar',
      proposalText:
        'تحية طيبة، يمكننا تنفيذ هذا المشروع بالكامل وفق أفضل الممارسات، مع خطة عمل واضحة ومواعيد تسليم محددة. ننصح بالبدء بجمع المتطلبات ثم التصميم ثم التنفيذ والاختبار.',
      recommendedPrice: '$1,200',
      estimatedDuration: 'أسبوعان',
    },
    ...overrides,
  };
}

export function makeAnalyzer(
  evaluations: Record<string, EvaluationResponse> = {},
): NonNullable<Container['openai']> {
  return {
    analyzeProject: async (input) =>
      makeEvaluationCall(evaluations[input.title ?? ''] ?? {}),
    generateProposal: async () => makeProposalCall(),
  };
}