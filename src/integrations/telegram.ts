import type { AppConfig } from '../config/env.js';
import { sleep } from '../utils/sleep.js';

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export class TelegramError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryAfter?: number) {
    super(message);
    this.name = 'TelegramError';
  }
}

export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

/**
 * Groups self-contained HTML blocks into Telegram messages that respect the
 * 4096 characters limit. Long tag-free blocks (e.g. proposal paragraphs) are
 * split at word boundaries without breaking HTML tags.
 */
export function paginateBlocks(blocks: string[], maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  const messages: string[] = [];
  let current = '';

  const pushCurrent = (): void => {
    if (current.trim() !== '') messages.push(current.trim());
    current = '';
  };

  for (const block of blocks) {
    const candidate = current === '' ? block : `${current}\n\n${block}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (block.length <= maxLength) {
      current = block;
    } else {
      // Chunk the block; keep only the last piece as `current` so it can still
      // merge with a following block, and emit the finished pieces as messages.
      const pieces = splitLongBlock(block, maxLength);
      for (let i = 0; i < pieces.length - 1; i += 1) {
        messages.push(pieces[i]!.trim());
      }
      current = pieces[pieces.length - 1] as string;
    }
  }
  pushCurrent();
  return messages.length > 0 ? messages : [''];
}

function splitLongBlock(block: string, maxLength: number): string[] {
  const words = block.split(/\s+/);
  const pieces: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      if (current !== '') pieces.push(current);
      current = word.length > maxLength ? word.slice(0, maxLength) : word;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

export interface TelegramSendResult {
  messageId: number;
}

export class TelegramClient {
  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.TELEGRAM_BOT_TOKEN && this.config.TELEGRAM_CHAT_ID);
  }

  /**
   * Sends a single HTML message. Bounded retries for transient failures (429/5xx).
   */
  async sendMessage(html: string, options: { disablePreview?: boolean; projectUrl?: string } = {}): Promise<TelegramSendResult> {
    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.sendOnce(html, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable =
          error instanceof TelegramError && (error.status === 429 || (error.status ?? 0) >= 500);
        if (!retryable || attempt === maxAttempts - 1) break;
        const retryAfter = error instanceof TelegramError ? error.retryAfter : undefined;
        const delay = retryAfter ? retryAfter * 1000 : Math.min(2 ** attempt * 2000, 15_000);
        await sleep(delay);
      }
    }
    throw lastError ?? new TelegramError('Telegram send failed');
  }

  /** Sends multiple messages sequentially, returning the first message id. */
  async sendMessages(messages: string[], options: { disablePreview?: boolean } = {}): Promise<TelegramSendResult> {
    let firstId = 0;
    for (let i = 0; i < messages.length; i += 1) {
      const result = await this.sendMessage(messages[i] as string, options);
      if (i === 0) firstId = result.messageId;
    }
    return { messageId: firstId };
  }

  private async sendOnce(html: string, options: { disablePreview?: boolean; projectUrl?: string }): Promise<TelegramSendResult> {
    if (!this.enabled) {
      throw new TelegramError('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.TELEGRAM_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.config.TELEGRAM_CHAT_ID,
            text: html,
            parse_mode: 'HTML',
            disable_web_page_preview: options.disablePreview ?? false,
            ...(options.projectUrl ? { reply_markup: { inline_keyboard: [[{ text: 'فتح المشروع على مستقل', url: options.projectUrl }]] } } : {}),
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: { message_id?: number };
        parameters?: { retry_after?: number };
      };
      if (!response.ok || body.ok !== true) {
        if (response.status === 401 || response.status === 403) {
          throw new TelegramError('Telegram authentication failed (check bot token)', response.status);
        }
        throw new TelegramError(
          body.description ?? `Telegram API error (HTTP ${response.status})`,
          response.status,
          body.parameters?.retry_after,
        );
      }
      return { messageId: body.result?.message_id ?? 0 };
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TelegramError('Telegram request timed out');
      }
      throw error instanceof Error ? error : new TelegramError(String(error));
    } finally {
      clearTimeout(timer);
    }
  }
}