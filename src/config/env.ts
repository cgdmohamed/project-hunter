import { z } from 'zod';
import { buildSelectors, type MostaqlSelectors } from './selectors.js';

const DEFAULT_BUDGET_USD_RATES: Record<string, number> = {
  USD: 1,
  SAR: 0.2667,
  AED: 0.2723,
  EGP: 0.0204,
  JOD: 1.4102,
  KWD: 3.2641,
  QAR: 0.2747,
  BHD: 2.6525,
  OMR: 2.598,
  EUR: 1.09,
  GBP: 1.27,
};

const DEFAULT_USER_AGENT =
  'ProjectHunterBot/1.0 (+https://mostaql.com; automated opportunity discovery for freelance work)';

const booleanish = (defaultValue: boolean) =>
  z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (v === '') return undefined;
        if (['1', 'true', 'yes', 'on'].includes(v)) return true;
        if (['0', 'false', 'no', 'off'].includes(v)) return false;
      }
      return value;
    }, z.boolean().default(defaultValue));

const jsonRecord = (defaultValue: Record<string, number>) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw || raw.trim() === '') return defaultValue;
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('must be a JSON object');
      }
      const out: Record<string, number> = { ...defaultValue };
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num) || num <= 0) {
          throw new Error(`rate for "${key}" must be a positive number`);
        }
        out[key.toUpperCase()] = num;
      }
      return out;
    });

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  SCAN_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  SCAN_ON_STARTUP: booleanish(false),
  AUTO_SCAN_ENABLED: booleanish(false),

  MIN_PROJECT_BUDGET_USD: z.coerce.number().positive().default(100),
  MIN_PROJECT_SCORE: z.coerce.number().min(0).max(100).default(75),

  MOSTAQL_BASE_URL: z.string().url().default('https://mostaql.com'),
  SCRAPER_ENABLED: booleanish(true),
  RSS_FEED_URL: z.string().url().optional(),
  SCRAPER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  SCRAPER_REQUEST_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(5000),
  SCRAPER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(1),
  SCRAPER_MAX_LISTING_PAGES: z.coerce.number().int().min(1).max(20).default(1),
  SCRAPER_RETRY_MAX: z.coerce.number().int().min(0).max(6).default(3),
  SCRAPER_STRUCTURE_MISMATCH_ALERT_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
  SCRAPER_DETAIL_REFRESH_HOURS: z.coerce.number().min(0).max(720).default(24),
  MOSTAQL_USER_AGENT: z.string().min(1).default(DEFAULT_USER_AGENT),
  MOSTAQL_SELECTORS: z.string().optional(),
  PLAYWRIGHT_ENABLED: booleanish(false),

  DATA_DIR: z.string().min(1).default('/app/data'),
  DATABASE_PATH: z.string().optional(),

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OPENAI_BASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().url().optional(),
  ),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(60000),
  OPENAI_MAX_TOKENS: z.coerce.number().int().min(256).max(32000).default(4000),
  OPENAI_INPUT_PRICE_PER_1M: z.coerce.number().nonnegative().default(0.15),
  OPENAI_OUTPUT_PRICE_PER_1M: z.coerce.number().nonnegative().default(0.6),
  OPENAI_MAX_ANALYSES_PER_SCAN: z.coerce.number().int().min(1).max(100).default(10),
  BUDGET_USD_RATES: jsonRecord(DEFAULT_BUDGET_USD_RATES),

  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),
  TELEGRAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(20000),

  ADMIN_API_KEY: z.string().min(1, 'ADMIN_API_KEY is required'),
  ALERT_DEDUP_MINUTES: z.coerce.number().int().min(0).max(10080).default(60),
});

export interface AppConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  LOG_LEVEL: string;
  SCAN_INTERVAL_MINUTES: number;
  SCAN_ON_STARTUP: boolean;
  AUTO_SCAN_ENABLED: boolean;
  MIN_PROJECT_BUDGET_USD: number;
  MIN_PROJECT_SCORE: number;
  MOSTAQL_BASE_URL: string;
  SCRAPER_ENABLED: boolean;
  RSS_FEED_URL?: string;
  SCRAPER_REQUEST_TIMEOUT_MS: number;
  SCRAPER_REQUEST_DELAY_MS: number;
  SCRAPER_MAX_CONCURRENCY: number;
  SCRAPER_MAX_LISTING_PAGES: number;
  SCRAPER_RETRY_MAX: number;
  SCRAPER_STRUCTURE_MISMATCH_ALERT_THRESHOLD: number;
  SCRAPER_DETAIL_REFRESH_HOURS: number;
  MOSTAQL_USER_AGENT: string;
  PLAYWRIGHT_ENABLED: boolean;
  DATA_DIR: string;
  DATABASE_PATH: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_BASE_URL?: string;
  OPENAI_REQUEST_TIMEOUT_MS: number;
  OPENAI_MAX_TOKENS: number;
  OPENAI_INPUT_PRICE_PER_1M: number;
  OPENAI_OUTPUT_PRICE_PER_1M: number;
  OPENAI_MAX_ANALYSES_PER_SCAN: number;
  BUDGET_USD_RATES: Record<string, number>;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_REQUEST_TIMEOUT_MS: number;
  ADMIN_API_KEY: string;
  ALERT_DEDUP_MINUTES: number;
  SELECTORS: MostaqlSelectors;
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(issues);
  }
  const data = parsed.data;
  const databasePath =
    data.DATABASE_PATH && data.DATABASE_PATH.trim() !== ''
      ? data.DATABASE_PATH
      : `${data.DATA_DIR.replace(/[\\/]+$/, '')}/project-hunter.sqlite`;

  return {
    ...data,
    DATABASE_PATH: databasePath,
    SELECTORS: buildSelectors(data.MOSTAQL_SELECTORS),
  };
}

export const DEFAULT_RATES = DEFAULT_BUDGET_USD_RATES;
