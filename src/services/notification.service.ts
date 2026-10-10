import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { AppDb } from '../database/client.js';
import type { AnalysisRow, ProjectRow, ProposalRow } from '../database/schema.js';
import { notifications, type NotificationRow } from '../database/schema.js';
import { eq } from 'drizzle-orm';
import { desc } from 'drizzle-orm';
import {
  escapeHtml,
  paginateBlocks,
  type TelegramSendResult,
  type TelegramClient,
} from '../integrations/telegram.js';
import type { Metrics } from '../utils/metrics.js';
import { nowIso } from '../utils/date.js';
import { EvaluationService } from './evaluation.service.js';
import { parseSkills } from './evaluation.service.js';
import type { NormalizationService } from './normalization.service.js';

export interface MessageSender {
  readonly enabled: boolean;
  sendMessage(html: string, options?: { disablePreview?: boolean }): Promise<TelegramSendResult>;
  sendMessages(messages: string[], options?: { disablePreview?: boolean }): Promise<TelegramSendResult>;
}

export interface OpportunitySendResult {
  status: 'sent' | 'skipped' | 'failed';
  notification: NotificationRow;
}

export class NotificationService {
  constructor(
    private readonly db: AppDb,
    private readonly config: AppConfig,
    private readonly sender: MessageSender,
    private readonly normalization: NormalizationService,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}

  // ---------------------------------------------------------------------
  // Opportunity notifications
  // ---------------------------------------------------------------------

  async sendOpportunity(project: ProjectRow, analysis: AnalysisRow, proposal: ProposalRow): Promise<OpportunitySendResult> {
    const dedupKey = `opportunity:${project.id}:${analysis.contentHash ?? project.contentHash}`;
    const existing = this.findByDedupKey(dedupKey);
    if (existing && existing.status !== 'failed') {
      this.logger.debug({ dedupKey }, 'opportunity notification already recorded — skipping');
      return { status: 'skipped', notification: existing };
    }

    if (!this.sender.enabled) {
      this.logger.warn('Telegram is not configured; opportunity cannot be delivered');
      return {
        status: 'failed',
        notification: this.insertNotification({
          projectId: project.id,
          notificationType: 'opportunity',
          dedupKey,
          status: 'failed',
          lastError: 'telegram not configured',
        }),
      };
    }

    const messages = this.buildOpportunityMessages(project, analysis, proposal);
    const createdAt = nowIso();
    let row: NotificationRow;

    try {
      // Persist progress after each successful part. Retrying only sends missing parts.
      // Telegram cannot guarantee exactly-once when its response is lost.
      let firstId = existing?.telegramMessageId ?? 0;
      for (let i = 0; i < messages.length; i += 1) {
        const partKey = `${dedupKey}:part:${i}`;
        const completed = this.db.select().from(notifications).where(eq(notifications.dedupKey, partKey)).get();
        if (completed?.status === 'sent') continue;
        const result = await this.sender.sendMessage(messages[i]!);
        if (!firstId) firstId = result.messageId;
        this.db.insert(notifications).values({
          projectId: project.id,
          notificationType: 'opportunity_part',
          dedupKey: partKey,
          status: 'sent',
          attempts: 1,
          telegramMessageId: result.messageId,
          sentAt: nowIso(),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }).onConflictDoUpdate({
          target: notifications.dedupKey,
          set: { status: 'sent', telegramMessageId: result.messageId, sentAt: nowIso(), updatedAt: nowIso() },
        }).run();
      }
      const result = { messageId: firstId };
      this.metrics.notificationsSent += 1;
      row = this.upsertNotification({
        projectId: project.id,
        notificationType: 'opportunity',
        dedupKey,
        status: 'sent',
        telegramMessageId: result.messageId,
        sentAt: nowIso(),
        lastError: null,
      }, existing, createdAt);
      this.logger.info({ projectId: project.id, messageId: result.messageId }, 'opportunity delivered');
      return { status: 'sent', notification: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metrics.notificationFailures += 1;
      this.logger.error({ projectId: project.id, error: message }, 'opportunity delivery failed');
      row = this.upsertNotification({
        projectId: project.id,
        notificationType: 'opportunity',
        dedupKey,
        status: 'failed',
        attempts: existing ? existing.attempts + 1 : 1,
        lastError: message,
      }, existing, createdAt);
      return { status: 'failed', notification: row };
    }
  }

  /**
   * Composes the full opportunity report as self-contained HTML blocks. Long
   * blocks (proposal paragraphs) are tag-free so pagination can split them.
   */
  buildOpportunityMessages(project: ProjectRow, analysis: AnalysisRow, proposal: ProposalRow): string[] {
    const view = EvaluationService.toView(analysis);
    const title = escapeHtml(project.title ?? 'مشروع بدون عنوان');
    const skills = parseSkills(project.skills) ?? [];

    const blocks: string[] = [];
    blocks.push(`<b>فرصة مشروع جديدة (AI Project Hunter)</b>`);
    blocks.push(`<b>${title}</b>`);
    blocks.push(
      `<a href="${escapeHtml(project.canonicalUrl)}">فتح المشروع على Mostaql</a>`,
    );

    const info: string[][] = [];
    info.push(['الميزانية المعلنة', escapeHtml(this.normalization.displayBudget(project))]);
    info.push(['التوافق التقني', `${view.score}/100`]);
    if (analysis.category) info.push(['التخصص', escapeHtml(analysis.category)]);
    if (project.proposalCount !== null) info.push(['عدد العروض الحالية', String(project.proposalCount)]);
    if (project.publishedAt) info.push(['نشر في', escapeHtml(project.publishedAt.replace('T', ' ').slice(0, 16))]);
    if (project.expectedDuration) info.push(['المدة المتوقعة', escapeHtml(project.expectedDuration)]);
    if (skills.length > 0) info.push(['المهارات المطلوبة', escapeHtml(skills.join('، '))]);
    blocks.push(info.map(([label, value]) => `<b>${label}:</b> ${value}`).join('\n'));

    blocks.push(`<b>ملخص المشروع</b>\n${escapeHtml(view.businessProblem || view.summary)}`);
    blocks.push(
      `<b>لماذا تناسبنا الفرصة</b>\n${escapeHtml(view.suitabilityReasons[0] || view.businessProblem)}`,
    );
    blocks.push(`<b>النهج التقني المقترح</b>\n${escapeHtml(view.recommendedApproach)}`);
    blocks.push(`<b>الجدوى المالية</b>\n${escapeHtml(view.financialViability)}`);

    if (view.risks.length > 0) {
      blocks.push(
        `<b>أبرز المخاطر</b>\n${view.risks.map((r) => `- ${escapeHtml(r)}`).join('\n')}`,
      );
    }
    if (view.missingRequirements.length > 0) {
      blocks.push(
        `<b>متطلبات غير واضحة</b>\n${view.missingRequirements.map((r) => `- ${escapeHtml(r)}`).join('\n')}`,
      );
    }
    if (view.clarificationQuestions.length > 0) {
      blocks.push(
        `<b>أسئلة توضيحية</b>\n${view.clarificationQuestions
          .slice(0, 2)
          .map((q) => `- ${escapeHtml(q)}`)
          .join('\n')}`,
      );
    }

    blocks.push(`<b>الإنفاق المقترح</b>: ${escapeHtml(view.recommendedPrice)}`);
    blocks.push(`<b>مدة التسليم المتوقعة</b>: ${escapeHtml(view.estimatedDuration)}`);

    blocks.push(`<b>مسودة عرض تقديمي (للمراجعة اليدوية)</b>`);
    const proposalParagraphs = proposal.proposalText
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p !== '');
    for (const paragraph of proposalParagraphs) {
      blocks.push(escapeHtml(paragraph));
    }
    blocks.push('<i>العرض لم يُرسل تلقائياً — يرجى مراجعته وتقديمه يدوياً.</i>');

    return paginateBlocks(blocks);
  }

  // ---------------------------------------------------------------------
  // Technical alerts
  // ---------------------------------------------------------------------

  async sendTechnicalAlert(key: string, title: string, body: string): Promise<boolean> {
    const dedupKey = `alert:${key}`;
    const windowMs = this.config.ALERT_DEDUP_MINUTES * 60_000;
    const recent = this.findRecentAlert(dedupKey, windowMs);
    if (recent) {
      this.logger.debug({ dedupKey }, 'technical alert already sent recently — suppressed');
      return false;
    }

    if (!this.sender.enabled) {
      this.logger.warn({ dedupKey, title }, 'Telegram not configured; alert suppressed');
      return false;
    }

    const blocks: string[] = [
      `<b>⚠️ [إدارة النظام] ${escapeHtml(title)}</b>`,
      escapeHtml(body),
      `<i>${nowIso()}</i>`,
    ];
    const message = paginateBlocks(blocks)[0] ?? '';

    try {
      const result = await this.sender.sendMessage(message, { disablePreview: true });
      this.metrics.alertsSent += 1;
      this.insertNotification({
        projectId: null,
        notificationType: 'alert',
        dedupKey,
        status: 'sent',
        telegramMessageId: result.messageId,
        sentAt: nowIso(),
        lastError: null,
      });
      return true;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      this.metrics.notificationFailures += 1;
      this.logger.error({ dedupKey, error: err }, 'technical alert delivery failed');
      this.insertNotification({
        projectId: null,
        notificationType: 'alert',
        dedupKey,
        status: 'failed',
        lastError: err,
      });
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  private findByDedupKey(dedupKey: string): NotificationRow | undefined {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupKey, dedupKey))
      .get();
  }

  private findRecentAlert(dedupKey: string, windowMs: number): NotificationRow | undefined {
    const row = this.db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupKey, dedupKey))
      .orderBy(desc(notifications.id))
      .get();
    if (!row) return undefined;
    const at = new Date(row.createdAt || row.sentAt || 0).getTime();
    return Date.now() - at < windowMs ? row : undefined;
  }

  private insertNotification(input: {
    projectId: number | null;
    notificationType: 'opportunity' | 'alert';
    dedupKey: string;
    status: 'pending' | 'sent' | 'failed' | 'skipped';
    telegramMessageId?: number | null;
    sentAt?: string | null;
    lastError?: string | null;
    attempts?: number;
  }): NotificationRow {
    return this.db
      .insert(notifications)
      .values({
        projectId: input.projectId,
        notificationType: input.notificationType,
        dedupKey: input.dedupKey,
        status: input.status,
        attempts: input.attempts ?? 1,
        telegramMessageId: input.telegramMessageId ?? null,
        sentAt: input.sentAt ?? null,
        lastError: input.lastError ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .onConflictDoNothing({ target: notifications.dedupKey })
      .returning()
      .get() as NotificationRow;
  }

  private upsertNotification(
    input: {
      projectId: number;
      notificationType: 'opportunity';
      dedupKey: string;
      status: 'sent' | 'failed';
      attempts?: number;
      telegramMessageId?: number | null;
      sentAt?: string | null;
      lastError?: string | null;
    },
    existing: NotificationRow | undefined,
    createdAt: string,
  ): NotificationRow {
    if (existing) {
      this.db
        .update(notifications)
        .set({
          status: input.status,
          attempts: input.attempts ?? existing.attempts + 1,
          telegramMessageId: input.telegramMessageId ?? existing.telegramMessageId,
          sentAt: input.sentAt ?? existing.sentAt,
          lastError: input.lastError,
          updatedAt: nowIso(),
        })
        .where(eq(notifications.id, existing.id))
        .run();
      return this.findByDedupKey(input.dedupKey)!;
    }
    return this.insertNotification({
      projectId: input.projectId,
      notificationType: input.notificationType,
      dedupKey: input.dedupKey,
      status: input.status,
      attempts: input.attempts ?? 1,
      telegramMessageId: input.telegramMessageId,
      sentAt: input.sentAt,
      lastError: input.lastError,
    });
  }
}

export type { TelegramClient };