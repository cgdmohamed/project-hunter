/**
 * Bounded in-memory metrics for the current process. Long-term numbers (scan
 * totals, database state) are read from the SQLite tables by the stats endpoint.
 */
export interface OpenAIUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export class Metrics {
  scansTotal = 0;
  scansSuccessful = 0;
  scansFailed = 0;
  projectsDiscovered = 0;
  projectsNew = 0;
  projectsDuplicate = 0;
  projectsBudgetRejected = 0;
  projectsAnalyzed = 0;
  projectsQualified = 0;
  projectsRejected = 0;
  projectsNeedsReview = 0;
  notificationsSent = 0;
  notificationFailures = 0;
  alertsSent = 0;

  httpResponses: Record<string, number> = {};
  mostaqlRequests = 0;
  mostaqlBlocked = 0;
  captchaDetected = 0;
  structureMismatches = 0;

  openaiInputTokens = 0;
  openaiOutputTokens = 0;
  openaiEstimatedCost = 0;
  openaiRequests = 0;
  openaiFailures = 0;

  scraperDowntimeMs = 0;
  lastBlockedAt: string | null = null;

  private lastScraperActiveAt = Date.now();

  recordHttp(status: number): void {
    const key = String(status);
    this.httpResponses[key] = (this.httpResponses[key] ?? 0) + 1;
  }

  markScraperActive(): void {
    this.lastScraperActiveAt = Date.now();
  }

  markScraperBlocked(timestamp = Date.now()): void {
    this.scraperDowntimeMs += Math.max(0, timestamp - this.lastScraperActiveAt);
    this.lastBlockedAt = new Date(timestamp).toISOString();
  }

  recordOpenAi(usage: OpenAIUsage): void {
    this.openaiRequests += 1;
    this.openaiInputTokens += usage.inputTokens;
    this.openaiOutputTokens += usage.outputTokens;
    this.openaiEstimatedCost += usage.estimatedCost;
  }

  snapshot(): Record<string, unknown> {
    return {
      scansTotal: this.scansTotal,
      scansSuccessful: this.scansSuccessful,
      scansFailed: this.scansFailed,
      projectsDiscovered: this.projectsDiscovered,
      projectsNew: this.projectsNew,
      projectsDuplicate: this.projectsDuplicate,
      projectsBudgetRejected: this.projectsBudgetRejected,
      projectsAnalyzed: this.projectsAnalyzed,
      projectsQualified: this.projectsQualified,
      projectsRejected: this.projectsRejected,
      projectsNeedsReview: this.projectsNeedsReview,
      notificationsSent: this.notificationsSent,
      notificationFailures: this.notificationFailures,
      alertsSent: this.alertsSent,
      httpResponses: this.httpResponses,
      mostaqlRequests: this.mostaqlRequests,
      mostaqlBlocked: this.mostaqlBlocked,
      captchaDetected: this.captchaDetected,
      structureMismatches: this.structureMismatches,
      openai: {
        requests: this.openaiRequests,
        inputTokens: this.openaiInputTokens,
        outputTokens: this.openaiOutputTokens,
        estimatedCostUsd: round(this.openaiEstimatedCost),
        failures: this.openaiFailures,
      },
      scraper: {
        downtimeMs: this.scraperDowntimeMs,
        lastBlockedAt: this.lastBlockedAt,
      },
    };
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Estimated USD cost from token counts using configurable per-1M-token prices.
 */
export function estimateOpenAiCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1M: number,
  outputPricePer1M: number,
): number {
  return (inputTokens / 1_000_000) * inputPricePer1M + (outputTokens / 1_000_000) * outputPricePer1M;
}