import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { ScanService } from '../services/scan.service.js';
import type { SystemSettingsService } from '../services/system-settings.service.js';
import type { TelegramClient } from './telegram.js';
import { escapeHtml } from './telegram.js';
import { sleep } from '../utils/sleep.js';

const OFFSET_KEY = 'telegram_poll_offset';
type Update = { update_id: number; message?: { text?: string; chat?: { id?: number | string } } };
type UpdatesResponse = { ok: boolean; result?: Update[]; description?: string };

export function parseTelegramCommand(text: string): 'scan' | 'status' | 'help' | null {
  const command = text.trim().split(/\s+/)[0]?.toLowerCase().split('@')[0];
  if (command === 'مشاريع' || command === '/scan' || command === '/projects') return 'scan';
  if (command === 'الحالة' || command === '/status' || command === 'إحصائيات' || command === '/stats') return 'status';
  if (command === 'مساعدة' || command === '/help' || command === '/start') return 'help';
  return null;
}

/** One long-polling consumer only. Persist offset to SQLite to avoid replay after restarts. */
export class TelegramCommandPoller {
  private stopped = true;
  private inflight: AbortController | null = null;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly settings: SystemSettingsService,
    private readonly scan: ScanService,
    private readonly sender: TelegramClient,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.inflight?.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const controller = new AbortController();
        this.inflight = controller;
        const timeout = setTimeout(() => controller.abort(), 35_000);
        let response: Response;
        try {
          const offset = Number(this.settings.get(OFFSET_KEY) ?? '0');
          const url = new URL(`https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/getUpdates`);
          url.searchParams.set('offset', String(offset));
          url.searchParams.set('timeout', '25');
          url.searchParams.set('allowed_updates', JSON.stringify(['message']));
          response = await fetch(url, { signal: controller.signal });
        } finally {
          clearTimeout(timeout);
          this.inflight = null;
        }
        if (!response.ok) throw new Error(`Telegram polling HTTP ${response.status}`);
        const data = await response.json() as UpdatesResponse;
        if (!data.ok) throw new Error(data.description ?? 'Telegram getUpdates failed');
        for (const update of data.result ?? []) {
          if (this.stopped) break;
          const offset = Number(this.settings.get(OFFSET_KEY) ?? '0');
          if (update.update_id < offset) continue;
          // Mark received update before processing: commands never replay on restart.
          this.settings.set(OFFSET_KEY, String(update.update_id + 1));
          if (String(update.message?.chat?.id ?? '') !== this.config.TELEGRAM_CHAT_ID) continue;
          const command = parseTelegramCommand(update.message?.text ?? '');
          if (!command) continue;
          if (command === 'help') {
            await this.sender.sendMessage('الأوامر: مشاريع /scan — فحص يدوي | الحالة /status — حالة النظام | مساعدة /help');
          } else if (command === 'status') {
            const lock = this.settings.get('scan_lock');
            const blocked = this.settings.get('scraper_blocked');
            await this.sender.sendMessage(`حالة النظام: ${blocked ? 'الجلب متوقف بسبب تقييد الوصول' : 'جاهز'}\nفحص جارٍ: ${lock ? 'نعم' : 'لا'}`);
          } else {
            if (this.scan.isRunning || this.settings.get('scan_lock')) {
              await this.sender.sendMessage('يوجد فحص قيد التنفيذ حاليًا. لن يتم تشغيل فحص مكرر.');
              continue;
            }
            if (this.settings.get('scraper_blocked')) {
              await this.sender.sendMessage('تعذر بدء الفحص: جمع المشاريع متوقف بسبب رفض وصول سابق من مستقل (HTTP 403 أو تقييد مماثل). لن نعيد المحاولة حتى تتم مراجعة السماح بالوصول.');
              continue;
            }
            await this.sender.sendMessage('بدأ فحص المشاريع الجديدة على مستقل...');
            // Avoid blocking getUpdates while scan runs; lock in ScanService prevents overlap.
            void this.scan.trigger('manual').then(async report => {
              if (report.status === 'skipped') {
                const reason = report.skippedReason === 'scraper_blocked'
                  ? 'تم تخطي الفحص: جمع المشاريع متوقف بسبب تقييد الوصول من مستقل.'
                  : report.skippedReason === 'lock_held'
                    ? 'تم تخطي الفحص: يوجد فحص آخر قيد التشغيل.'
                    : report.skippedReason === 'scraper_disabled'
                      ? 'تم تخطي الفحص: جمع المشاريع معطل من الإعدادات.'
                      : `تم تخطي الفحص: ${report.skippedReason ?? 'سبب غير محدد'}`;
                await this.sender.sendMessage(escapeHtml(reason));
                return;
              }
              const summary = [
                'نتيجة فحص المشاريع',
                `الحالة: ${report.status}`,
                `المكتشفة: ${report.discovered}`,
                `الجديدة: ${report.newCount}`,
                `المكررة: ${report.duplicates}`,
                `تم تحليلها: ${report.analyzed}`,
                `المناسبة: ${report.qualified}`,
                `الإشعارات: ${report.notified}`,
                `الأخطاء: ${report.errors}`,
                report.blocked ? 'الجلب متوقف بسبب تقييد الوصول' : '',
                report.errorMessage ? `الخطأ: ${report.errorMessage}` : '',
              ].filter(Boolean).join('\n');
              await this.sender.sendMessage(escapeHtml(summary));
            }).catch(error => this.logger.error({ error: String(error) }, 'telegram manual scan failed'));
          }
        }
      } catch (error) {
        if (this.stopped) break;
        this.logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'telegram polling error');
        await sleep(5000);
      }
    }
  }
}
