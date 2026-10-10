import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { AppDb } from '../database/client.js';
import { scanLogs, type ProjectRow } from '../database/schema.js';
import { BlockedAccessError } from '../integrations/http.js';
import type { ProjectSource } from '../sources/project-source.interface.js';
import { evaluateBudget, type BudgetUsd } from '../utils/money.js';
import type { Metrics } from '../utils/metrics.js';
import { nowIso } from '../utils/date.js';
import type { DiscoveryService } from './discovery.service.js';
import type { EvaluationService } from './evaluation.service.js';
import type { NormalizationService } from './normalization.service.js';
import type { NotificationService } from './notification.service.js';
import type { ProjectRepository } from './project.repository.js';
import type { ProposalService } from './proposal.service.js';
import type { ScanLockService } from './system-settings.service.js';
import type { ScraperHealthService } from './scraper-health.service.js';

export type ScanTrigger = 'startup' | 'schedule' | 'manual';

export interface ScanReport {
  status: 'success' | 'failed' | 'partial' | 'skipped';
  scanLogId: number | null;
  discovered: number;
  newCount: number;
  duplicates: number;
  analyzed: number;
  qualified: number;
  notified: number;
  budgetRejected: number;
  needsReview: number;
  errors: number;
  blocked: boolean;
  skippedReason?: string;
  errorMessage?: string;
  durationMs: number;
}

const OPENAI_FAILURE_ALERT_THRESHOLD = 3;

export class ScanService {
  private running = false;

  constructor(
    private readonly db: AppDb,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly repo: ProjectRepository,
    private readonly source: ProjectSource,
    private readonly discovery: DiscoveryService,
    private readonly normalization: NormalizationService,
    private readonly evaluation: EvaluationService,
    private readonly proposal: ProposalService,
    private readonly notification: NotificationService,
    private readonly lock: ScanLockService,
    private readonly health: ScraperHealthService,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async trigger(reason: ScanTrigger): Promise<ScanReport> {
    const startedAt = Date.now();
    this.lock.recoverExpired();

    if (!this.config.SCRAPER_ENABLED) {
      return this.skipped('scraper_disabled', startedAt);
    }
    if (!this.config.RSS_FEED_URL && this.health.isBlocked()) {
      const state = this.health.getBlockState();
      this.logger.warn({ state }, 'scraper is blocked; scan skipped pending administrator reset');
      return this.skipped('scraper_blocked', startedAt);
    }

    const owner = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ttlMs = Math.max(this.config.SCAN_INTERVAL_MINUTES * 60_000, 10 * 60_000);
    if (!this.lock.acquire(owner, ttlMs)) {
      this.logger.warn({ reason }, 'another scan holds the lock; skipping');
      return this.skipped('lock_held', startedAt);
    }

    this.running = true;
    const scanLogId = this.startScanLog();
    this.metrics.scansTotal += 1;

    try {
      const report = await this.runPipeline(scanLogId);
      report.durationMs = Date.now() - startedAt;
      this.finalizeScanLog(scanLogId, report);
      if (report.status === 'failed') this.metrics.scansFailed += 1;
      else this.metrics.scansSuccessful += 1;
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: message }, 'scan pipeline crashed');
      this.metrics.scansFailed += 1;
      const report: ScanReport = {
        status: 'failed',
        scanLogId,
        discovered: 0,
        newCount: 0,
        duplicates: 0,
        analyzed: 0,
        qualified: 0,
        notified: 0,
        budgetRejected: 0,
        needsReview: 0,
        errors: 1,
        blocked: false,
        errorMessage: message,
        durationMs: Date.now() - startedAt,
      };
      this.finalizeScanLog(scanLogId, report);
      return report;
    } finally {
      this.running = false;
      this.lock.release(owner);
    }
  }

  private async runPipeline(scanLogId: number): Promise<ScanReport> {
    const report: ScanReport = {
      status: 'success',
      scanLogId,
      discovered: 0,
      newCount: 0,
      duplicates: 0,
      analyzed: 0,
      qualified: 0,
      notified: 0,
      budgetRejected: 0,
      needsReview: 0,
      errors: 0,
      blocked: false,
      durationMs: 0,
    };

    // Retry deliveries that failed in a previous scan BEFORE discovering new
    // work, so a failure is retried on the next scan — never in the same cycle.
    await this.retryFailedNotifications(report);

    let discovery;
    try {
      discovery = await this.discovery.discover();
    } catch (error) {
      if (error instanceof BlockedAccessError) {
        await this.handleBlock(error);
        report.blocked = true;
        report.status = 'failed';
        report.errorMessage = error.message;
        return report;
      }
      throw error;
    }

    report.discovered = discovery.totalListed;
    report.newCount = discovery.newCount;
    report.duplicates = discovery.duplicateCount;

    if (discovery.structureMismatch && this.health.shouldStructureAlert()) {
      await this.notification.sendTechnicalAlert(
        'html_structure_mismatch',
        'فشل تحليل بنية صفحة المشاريع',
        'لم يتم العثور على أي روابط مشاريع في صفحة القائمة لعدة مرات متتالية. قد تغيّرت بنية HTML في Mostaql. تحقق من محددات CSS (MOSTAQL_SELECTORS) قبل الاستمرار.',
      );
    }

    // Determine which projects need detail work (new/changed + previously failed).
    const needIds = new Set<number>(discovery.projectIdsNeedingDetail);
    for (const row of this.repo.findNeedingDetail()) needIds.add(row.id);

    const openAiFailuresBefore = this.metrics.openaiFailures;

    for (const id of needIds) {
      const project = this.repo.getById(id);
      if (!project) continue;
      try {
        await this.ensureDetail(project);
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          await this.handleBlock(error);
          report.blocked = true;
          report.status = 'failed';
          report.errorMessage = error.message;
          return report;
        }
        report.errors += 1;
        this.logger.error(
          { projectId: id, error: error instanceof Error ? error.message : String(error) },
          'detail processing failed',
        );
      }
    }

    const processable = this.repo.findProcessable(this.config.OPENAI_MAX_ANALYSES_PER_SCAN);
    for (const project of processable) {
      try {
        await this.processProject(project, report);
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          await this.handleBlock(error);
          report.blocked = true;
          report.status = 'failed';
          report.errorMessage = error.message;
          return report;
        }
        report.errors += 1;
        this.logger.error(
          { projectId: project.id, error: error instanceof Error ? error.message : String(error) },
          'project processing failed',
        );
      }
    }

    if (this.metrics.openaiFailures - openAiFailuresBefore >= OPENAI_FAILURE_ALERT_THRESHOLD) {
      await this.notification.sendTechnicalAlert(
        'openai_failures',
        'فشل متكرر في OpenAI',
        'تكررت أخطاء الاتصال بـ OpenAI عدة مرات خلال نفس الدورة. تحقق من مفتاح API والحصة (quota).',
      );
    }

    if (report.errors > 0) report.status = 'partial';
    return report;
  }

  /**
   * Retries delivery for projects whose previous notification attempt failed,
   * reusing the stored analysis/proposal (no re-analysis, so no extra AI cost).
   */
  private async retryFailedNotifications(report: ScanReport): Promise<void> {
    const failed = this.repo.findByStatus('notification_failed', this.config.OPENAI_MAX_ANALYSES_PER_SCAN);
    for (const project of failed) {
      try {
        const analysis = this.repo.latestAnalysis(project.id);
        if (!analysis) continue;
        let proposal = this.repo.latestProposal(project.id);
        if (!proposal) {
          const generated = await this.proposal.generateAndSave(project, analysis);
          proposal = generated.proposal;
        }
        const send = await this.notification.sendOpportunity(project, analysis, proposal);
        const nextStatus = send.status === 'sent' ? 'notified' : 'notification_failed';
        this.repo.updateStatus(project.id, nextStatus);
        if (send.status === 'sent') report.notified += 1;
      } catch (error) {
        report.errors += 1;
        this.logger.error(
          { projectId: project.id, error: error instanceof Error ? error.message : String(error) },
          'notification retry failed',
        );
      }
    }
  }

  private async ensureDetail(project: ProjectRow): Promise<void> {
    const parsed = await this.source.fetchProjectDetail(project.canonicalUrl);
    const structureOk =
      parsed.structure.title || parsed.structure.description || parsed.structure.budget;

    if (!structureOk) {
      this.health.recordStructureMismatch();
      this.logger.warn({ projectId: project.id }, 'detail page parsed without key fields');
      return;
    }
    this.health.resetStructureMismatch();

    const normalized = this.normalization.buildFromDetail(
      this.source.name,
      project.externalId,
      project.canonicalUrl,
      parsed,
    );
    const changed = project.contentHash !== normalized.contentHash;
    const reprocess =
      changed || project.status === 'discovered' || project.status === 'budget_rejected' || (project.status === 'needs_review' && !this.config.RSS_FEED_URL);

    this.repo.applyDetail(project.id, normalized, { markPendingAnalysis: reprocess });
  }

  private async processProject(project: ProjectRow, report: ScanReport): Promise<void> {
    const budgetUsd: BudgetUsd = {
      minUsd: project.budgetMinUsd,
      maxUsd: project.budgetMaxUsd,
      convertible: true,
    };
    const decision = evaluateBudget(budgetUsd, this.config.MIN_PROJECT_BUDGET_USD);

    if (decision === 'rejected') {
      this.repo.updateStatus(project.id, 'budget_rejected');
      this.metrics.projectsBudgetRejected += 1;
      report.budgetRejected += 1;
      return;
    }

    const outcome = await this.evaluation.analyze(project);
    report.analyzed += 1;

    // Reject technically unsuitable projects even if the RSS feed has no budget.
    if (!outcome.qualified) {
      this.repo.updateStatus(project.id, 'rejected');
      return;
    }

    if (decision === 'needs_review') {
      this.repo.updateStatus(project.id, 'needs_review');
      this.metrics.projectsNeedsReview += 1;
      report.needsReview += 1;
      const notified = await this.notification.sendBudgetReview(project, outcome.analysis);
      if (notified) report.notified += 1;
      return;
    }

    this.repo.updateStatus(project.id, 'qualified');
    report.qualified += 1;

    const { proposal } = await this.proposal.generateAndSave(project, outcome.analysis);
    const send = await this.notification.sendOpportunity(project, outcome.analysis, proposal);
    this.repo.updateStatus(project.id, send.status === 'sent' ? 'notified' : 'notification_failed');
    if (send.status === 'sent') report.notified += 1;
  }

  private async handleBlock(error: BlockedAccessError): Promise<void> {
    this.health.setBlocked(error.reason, error.status);
    this.metrics.mostaqlBlocked += 1;
    this.logger.error({ reason: error.reason, status: error.status }, 'scraping blocked — stopping');
    await this.notification.sendTechnicalAlert(
      'scraper_blocked',
      'تم إيقاف جمع البيانات (Scraper Blocked)',
      `تم حظر الوصول إلى Mostaql. السبب: ${error.reason} (HTTP ${error.status ?? 'n/a'}). تم إيقاف الجمع تلقائياً. لا تتم إعادة المحاولة حتى يقوم المسؤول بإزالة الحظر عبر POST /internal/scraper/unblock.`,
    );
  }

  /**
   * Re-runs the AI pipeline (plus budget filter) for a single project.
   * Used by the internal administration API.
   */
  async reanalyzeProject(id: number): Promise<{ ok: boolean; message: string; status?: string; score?: number }> {
    const project = this.repo.getById(id);
    if (!project) return { ok: false, message: 'project not found' };

    this.repo.updateStatus(id, 'pending_analysis');
    const report: ScanReport = {
      status: 'success',
      scanLogId: null,
      discovered: 0,
      newCount: 0,
      duplicates: 0,
      analyzed: 0,
      qualified: 0,
      notified: 0,
      budgetRejected: 0,
      needsReview: 0,
      errors: 0,
      blocked: false,
      durationMs: 0,
    };
    try {
      await this.processProject(project, report);
      const updated = this.repo.getById(id);
      const analysis = this.repo.latestAnalysis(id);
      return {
        ok: true,
        message: 'reanalyzed',
        status: updated?.status,
        score: analysis?.score,
      };
    } catch (error) {
      this.logger.error(
        { projectId: id, error: error instanceof Error ? error.message : String(error) },
        'manual reanalysis failed',
      );
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Regenerates the proposal draft for a project using its latest analysis. */
  async regenerateProposal(id: number) {
    const project = this.repo.getById(id);
    if (!project) return { ok: false, message: 'project not found' } as const;
    const analysis = this.repo.latestAnalysis(id);
    if (!analysis) return { ok: false, message: 'project has no analysis yet' } as const;
    try {
      const { proposal } = await this.proposal.generateAndSave(project, analysis);
      return { ok: true, proposal } as const;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      } as const;
    }
  }

  /** Clears a prior block so the scraper may resume (administrator decision). */
  unblockScraper(): void {
    this.health.clearBlocked();
    this.logger.warn('scraper block cleared manually by administrator');
  }

  private skipped(reason: string, startedAt: number): ScanReport {
    return {
      status: 'skipped',
      scanLogId: null,
      discovered: 0,
      newCount: 0,
      duplicates: 0,
      analyzed: 0,
      qualified: 0,
      notified: 0,
      budgetRejected: 0,
      needsReview: 0,
      errors: 0,
      blocked: false,
      skippedReason: reason,
      durationMs: Date.now() - startedAt,
    };
  }

  private startScanLog(): number {
    const row = this.db
      .insert(scanLogs)
      .values({ startedAt: nowIso(), status: 'running' })
      .returning()
      .get();
    return row.id;
  }

  private finalizeScanLog(id: number, report: ScanReport): void {
    this.db
      .update(scanLogs)
      .set({
        completedAt: nowIso(),
        durationMs: report.durationMs,
        discoveredCount: report.discovered,
        newCount: report.newCount,
        duplicateCount: report.duplicates,
        analyzedCount: report.analyzed,
        qualifiedCount: report.qualified,
        budgetRejectedCount: report.budgetRejected,
        needsReviewCount: report.needsReview,
        notifiedCount: report.notified,
        errorCount: report.errors,
        status: report.status === 'skipped' ? 'success' : report.status === 'partial' ? 'partial' : report.status,
        errorMessage: report.errorMessage ?? null,
      })
      .where(eq(scanLogs.id, id))
      .run();
  }
}