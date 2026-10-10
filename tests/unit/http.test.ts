import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedAccessError, HttpFetcher, isCaptchaResponse } from '../../src/integrations/http.js';
import { Metrics } from '../../src/utils/metrics.js';

const config = {
  SCRAPER_REQUEST_TIMEOUT_MS: 5000,
  SCRAPER_REQUEST_DELAY_MS: 0,
  SCRAPER_RETRY_MAX: 3,
  MOSTAQL_USER_AGENT: 'TestAgent/1.0',
  PLAYWRIGHT_ENABLED: false,
};

function mockResponse(status: number, body: string): Response {
  if (status === 500) throw new Error('boom');
  return new Response(body, { status });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => handler(String(url), init)));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('http fetcher', () => {
  it('fetches a page successfully on first attempt', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      return new Response('<html>ok</html>', { status: 200 });
    });
    const result = await new HttpFetcher(config).fetchHtml('https://mostaql.com/projects');
    expect(result.text).toBe('<html>ok</html>');
    expect(calls).toHaveLength(1);
  });

  it('retries transient 500 errors with bounded backoff then succeeds', async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      if (attempts < 3) return new Response('error', { status: 500 });
      return new Response('<html>recovered</html>', { status: 200 });
    });
    const result = await new HttpFetcher(config).fetchHtml('https://mostaql.com/projects');
    expect(result.text).toBe('<html>recovered</html>');
    expect(attempts).toBe(3);
  });

  it('halts immediately on HTTP 429 without retrying', async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      return new Response('slow down', { status: 429, headers: { 'Retry-After': '60' } });
    });
    const metrics = new Metrics();
    const error = await new HttpFetcher(config, metrics)
      .fetchHtml('https://mostaql.com/projects')
      .catch((e) => e);
    expect(error).toBeInstanceOf(BlockedAccessError);
    expect((error as BlockedAccessError).reason).toBe('http429');
    expect((error as BlockedAccessError).message).toContain('Retry-After: 60');
    expect(attempts).toBe(1);
    expect(metrics.mostaqlBlocked).toBe(1);
  });

  it('treats HTTP 403 as an explicit block and does not retry', async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      return new Response('forbidden', { status: 403 });
    });
    const metrics = new Metrics();
    await expect(new HttpFetcher(config, metrics).fetchHtml('https://mostaql.com/projects')).rejects.toBeInstanceOf(
      BlockedAccessError,
    );
    expect(attempts).toBe(1);
    expect(metrics.mostaqlBlocked).toBe(1);
  });

  it('detects a CAPTCHA challenge and blocks', async () => {
    stubFetch(() => new Response('<html>Checking your browser... reCAPTCHA</html>', { status: 200 }));
    const metrics = new Metrics();
    const error = await new HttpFetcher(config, metrics)
      .fetchHtml('https://mostaql.com/projects')
      .catch((e) => e);
    expect(error).toBeInstanceOf(BlockedAccessError);
    expect((error as BlockedAccessError).reason).toBe('captcha');
    expect(metrics.captchaDetected).toBe(1);
  });

  it('gives up after bounded retries for persistent 5xx failures', async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      return new Response('down', { status: 500 });
    });
    await expect(new HttpFetcher(config).fetchHtml('https://mostaql.com/projects')).rejects.toThrow('HTTP 500');
    expect(attempts).toBe(config.SCRAPER_RETRY_MAX + 1);
  });

  it('recognises captcha markers', () => {
    expect(isCaptchaResponse('cf-challenge found')).toBe(true);
    expect(isCaptchaResponse('normal content')).toBe(false);
  });
});

void mockResponse;