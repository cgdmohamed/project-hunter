import type { AppConfig } from '../config/env.js';
import type { Metrics } from '../utils/metrics.js';
import { sleep } from '../utils/sleep.js';

export interface FetchResult {
  status: number;
  text: string;
  url: string;
}

export type BlockReason = 'http403' | 'http429' | 'captcha' | 'robots' | 'http404';

export class BlockedAccessError extends Error {
  reason: BlockReason;
  status: number | null;
  constructor(reason: BlockReason, status: number | null = null, message?: string) {
    super(message ?? `Scraper access blocked: ${reason}`);
    this.name = 'BlockedAccessError';
    this.reason = reason;
    this.status = status;
  }
}

export class HttpFetcher {
  constructor(
    private readonly config: Pick<
      AppConfig,
      | 'SCRAPER_REQUEST_TIMEOUT_MS'
      | 'SCRAPER_REQUEST_DELAY_MS'
      | 'SCRAPER_RETRY_MAX'
      | 'MOSTAQL_USER_AGENT'
      | 'PLAYWRIGHT_ENABLED'
    >,
    private readonly metrics?: Metrics,
  ) {}

  private recordHttp(status: number): void {
    this.metrics?.recordHttp(status);
    this.metrics?.markScraperActive();
  }

  /**
   * Fetches a page as text. Throws BlockedAccessError on explicit blocking
   * (403 / CAPTCHA / robots disagreement). Retries transient failures with
   * bounded exponential backoff.
   */
  async fetchHtml(url: string, opts: { renderWithPlaywright?: boolean } = {}): Promise<FetchResult> {
    const maxRetries = this.config.SCRAPER_RETRY_MAX;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        const backoff = Math.min(2 ** (attempt - 1) * 3000 + Math.random() * 1000, 30_000);
        await sleep(backoff);
      } else if (this.config.SCRAPER_REQUEST_DELAY_MS > 0) {
        await sleep(this.config.SCRAPER_REQUEST_DELAY_MS);
      }

      const finalAttempt = attempt >= maxRetries;
      try {
        const result = await this.fetchOnce(url, opts);
        return result;
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          if (this.metrics) {
            this.metrics.mostaqlBlocked += 1;
            if (error.reason === 'captcha') this.metrics.captchaDetected += 1;
          }
          throw error;
        }
        if (!finalAttempt) {
          this.metrics?.recordHttp(0);
          continue;
        }
        if (this.config.PLAYWRIGHT_ENABLED && !opts.renderWithPlaywright) {
          return this.renderWithPlaywright(url);
        }
        throw error;
      }
    }
    // Unreachable: the loop always returns or throws.
    throw new Error('unreachable');
  }

  private async fetchOnce(url: string, opts: { renderWithPlaywright?: boolean }): Promise<FetchResult> {
    const timeoutMs = this.config.SCRAPER_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      if (this.metrics) this.metrics.mostaqlRequests += 1;
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': this.config.MOSTAQL_USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'ar,en;q=0.8',
        },
        redirect: 'follow',
      });
    } catch (error) {
      throw this.wrapNetworkError(error);
    } finally {
      clearTimeout(timer);
    }

    this.recordHttp(response.status);

    if (response.status === 403) {
      throw new BlockedAccessError('http403', 403, `HTTP 403 Forbidden from ${url}`);
    }
    if (response.status === 404) {
      throw new BlockedAccessError('http404', 404, `HTTP 404 from ${url}`);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      throw new BlockedAccessError(
        'http429',
        429,
        `HTTP 429 Too Many Requests from ${url}; Retry-After: ${retryAfter ?? 'unspecified'}. Scraper suspended pending review.`,
      );
    }
    if (response.status >= 500) {
      const error = new Error(`HTTP ${response.status} from ${url}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    const text = await response.text();
    if (isCaptchaResponse(text)) {
      throw new BlockedAccessError('captcha', response.status, `CAPTCHA/challenge page detected from ${url}`);
    }
    return { status: response.status, text, url: response.url ?? url };
  }

  private async renderWithPlaywright(url: string): Promise<FetchResult> {
    // Playwright is an optional, explicitly-enabled fallback. When it is not
    // installed, the failure is reported rather than silently fabricating data.
    let playwright: {
      chromium: { launch: (opts: unknown) => Promise<{ newPage: (opts: unknown) => Promise<{ goto: (url: string, opts: unknown) => Promise<unknown>; content: () => Promise<string>; url: () => string }>; close: () => Promise<void> }> };
    };
    try {
      // @ts-expect-error - "playwright" is an optional runtime dependency.
      playwright = await import('playwright');
    } catch {
      throw new BlockedAccessError(
        'robots',
        null,
        'PLAYWRIGHT_ENABLED=true but the "playwright" package/browser is not installed',
      );
    }
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ userAgent: this.config.MOSTAQL_USER_AGENT });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.SCRAPER_REQUEST_TIMEOUT_MS });
      const text = await page.content();
      if (isCaptchaResponse(text)) {
        throw new BlockedAccessError('captcha', 200, 'CAPTCHA/challenge page detected after rendering');
      }
      return { status: 200, text, url: page.url() };
    } finally {
      await browser.close();
    }
  }

  private wrapNetworkError(error: unknown): Error {
    if (error instanceof Error && error.name === 'AbortError') {
      return new Error('Request timed out');
    }
    if (error instanceof Error) return error;
    return new Error(`Network request failed: ${String(error)}`);
  }
}

const CAPTCHA_MARKERS = [
  /captcha/i,
  /reCAPTCHA/i,
  /hcaptcha/i,
  /verify\s+(you\s+are\s+)?a\s+human/i,
  /are\s+you\s+a\s+human/i,
  /checking\s+your\s+browser/i,
  /enable\s+javascript\s+and\s+cookies/i,
  /تحقق\s+من\s+البيانات/i,
  /التحقق\s+البشري/i,
  /كلمة\s+التحقق/i,
  /ora\.sh\s+challenge/i,
  /cf-challenge/i,
];

export function isCaptchaResponse(text: string): boolean {
  return CAPTCHA_MARKERS.some((marker) => marker.test(text));
}

/** Very small helper so the health monitor can reuse the metrics object. */
export function resetBlockedFlags(metrics?: Metrics): void {
  if (metrics) metrics.mostaqlBlocked = 0;
}
void resetBlockedFlags;