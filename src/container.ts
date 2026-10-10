import type BetterSqlite3 from 'better-sqlite3';
import type { Logger } from 'pino';
import type { AppConfig } from './config/env.js';
import type { AppDb } from './database/client.js';
import { createDrizzle, openDatabase } from './database/client.js';
import { HttpFetcher } from './integrations/http.js';
import { OpenAiClient } from './integrations/openai.js';
import { TelegramClient } from './integrations/telegram.js';
import { MostaqlSource } from './sources/mostaql/mostaql.source.js';
import type { ProjectSource } from './sources/project-source.interface.js';
import { DiscoveryService } from './services/discovery.service.js';
import { EvaluationService } from './services/evaluation.service.js';
import { NormalizationService } from './services/normalization.service.js';
import { NotificationService } from './services/notification.service.js';
import { ProjectRepository } from './services/project.repository.js';
import { ProposalService } from './services/proposal.service.js';
import { ScanService } from './services/scan.service.js';
import { ScraperHealthService } from './services/scraper-health.service.js';
import { ScanLockService, SystemSettingsService } from './services/system-settings.service.js';
import { Metrics } from './utils/metrics.js';
import { createLogger } from './utils/logger.js';

export interface ContainerOverrides {
  logger?: Logger;
  metrics?: Metrics;
  telegram?: Pick<TelegramClient, 'enabled' | 'sendMessage' | 'sendMessages'>;
  openai?: {
    analyzeProject?: OpenAiClient['analyzeProject'];
    generateProposal?: OpenAiClient['generateProposal'];
  };
  source?: ProjectSource;
  databasePath?: string;
}

export interface Container {
  config: AppConfig;
  logger: Logger;
  sqlite: BetterSqlite3.Database;
  db: AppDb;
  metrics: Metrics;
  settings: SystemSettingsService;
  lock: ScanLockService;
  http: HttpFetcher;
  source: ProjectSource;
  normalization: NormalizationService;
  repo: ProjectRepository;
  health: ScraperHealthService;
  openai: OpenAiClient;
  evaluation: EvaluationService;
  proposal: ProposalService;
  telegram: TelegramClient;
  notification: NotificationService;
  discovery: DiscoveryService;
  scan: ScanService;
}

export function buildContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? createLogger('ai-project-hunter', config.LOG_LEVEL);
  const metrics = overrides.metrics ?? new Metrics();

  const dbPath = overrides.databasePath ?? config.DATABASE_PATH;
  const sqlite = openDatabase(dbPath);
  const db = createDrizzle(sqlite);

  const http = new HttpFetcher(config, metrics);
  const source = overrides.source ?? new MostaqlSource(config, http);

  const settings = new SystemSettingsService(db);
  const lock = new ScanLockService(settings);
  const normalization = new NormalizationService(config);
  const repo = new ProjectRepository(db);
  const health = new ScraperHealthService(
    settings,
    metrics,
    config.SCRAPER_STRUCTURE_MISMATCH_ALERT_THRESHOLD,
  );

  const openai = overrides.openai
    ? (Object.assign(new OpenAiClient(config), overrides.openai) as OpenAiClient)
    : new OpenAiClient(config);

  const evaluation = new EvaluationService(db, config, openai, normalization, logger, metrics);
  const proposal = new ProposalService(db, config, openai, logger, metrics);

  const telegram = (overrides.telegram ?? new TelegramClient(config)) as TelegramClient;
  const notification = new NotificationService(db, config, telegram, normalization, logger, metrics);

  const discovery = new DiscoveryService(source, repo, normalization, health, metrics, config, logger);
  const scan = new ScanService(
    db,
    config,
    logger,
    metrics,
    repo,
    source,
    discovery,
    normalization,
    evaluation,
    proposal,
    notification,
    lock,
    health,
  );

  return {
    config,
    logger,
    sqlite,
    db,
    metrics,
    settings,
    lock,
    http,
    source,
    normalization,
    repo,
    health,
    openai,
    evaluation,
    proposal,
    telegram,
    notification,
    discovery,
    scan,
  };
}