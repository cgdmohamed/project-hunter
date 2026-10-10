import { afterEach, describe, expect, it } from 'vitest';
import { scanLogs } from '../../src/database/schema.js';
import {
  buildTestContainer,
  createFakeSource,
  makeAnalyzer,
  makeDetail,
  makeEvaluationCall,
  makeListing,
  type TestContainerHandle,
} from '../support/testkit.js';

describe('scan pipeline (integration)', () => {
  let handle: TestContainerHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  function setupDetails() {
    return {
      'p-qualified': makeDetail({ title: 'مشروع مؤهل', budgetRaw: '$500 - $2,500' }),
      'p-lowbudget': makeDetail({ title: 'مشروع رخيص', budgetRaw: '$40 - $80' }),
      'p-open': makeDetail({ title: 'مشروع مفتوح', budgetRaw: 'الميزانية مفتوحة' }),
      'p-lowscore': makeDetail({ title: 'مشروع ضعيف', budgetRaw: '$500 - $1,000' }),
    };
  }

  function setupEvaluations() {
    const low = makeEvaluationCall({
      criteria: {
        capabilityMatch: 5,
        financialViability: 5,
        requirementsClarity: 5,
        deliveryFeasibility: 5,
        riskFactor: 5,
      },
    }).result;
    return {
      'مشروع مؤهل': makeEvaluationCall().result,
      'مشروع رخيص': makeEvaluationCall().result,
      'مشروع مفتوح': makeEvaluationCall().result,
      'مشروع ضعيف': low,
    };
  }

  function build() {
    const listing = [
      makeListing('p-qualified', 'مشروع مؤهل'),
      makeListing('p-lowbudget', 'مشروع رخيص'),
      makeListing('p-open', 'مشروع مفتوح'),
      makeListing('p-lowscore', 'مشروع ضعيف'),
    ];
    return buildTestContainer({
      source: createFakeSource(listing, setupDetails()),
      openai: makeAnalyzer(setupEvaluations()),
      config: { SCRAPER_DETAIL_REFRESH_HOURS: 24 },
    });
  }

  it('discovers, filters budgets, scores, generates proposals and notifies', async () => {
    handle = build();
    const report = await handle.container.scan.trigger('manual');

    expect(report.status).toBe('success');
    expect(report.newCount).toBe(4);
    expect(report.duplicates).toBe(0);
    expect(report.budgetRejected).toBe(1);
    expect(report.needsReview).toBe(1);
    expect(report.qualified).toBe(1);
    expect(report.notified).toBe(1);

    const all = handle.container.repo.list({ limit: 100 });
    const byTitle = (title: string) => all.find((p) => p.title === title);

    expect(byTitle('مشروع مؤهل')?.status).toBe('notified');
    expect(byTitle('مشروع رخيص')?.status).toBe('budget_rejected');
    expect(byTitle('مشروع مفتوح')?.status).toBe('needs_review');
    expect(byTitle('مشروع ضعيف')?.status).toBe('rejected');

    // A proposal draft is stored only for the qualified project.
    const qualified = byTitle('مشروع مؤهل');
    expect(qualified).toBeTruthy();
    expect(handle.container.repo.latestProposal(qualified!.id)).toBeTruthy();
    expect(handle.container.repo.latestAnalysis(byTitle('مشروع رخيص')!.id)).toBeUndefined();
  });

  it('formats the Telegram notification with details and a direct link', async () => {
    handle = build();
    await handle.container.scan.trigger('manual');

    expect(handle.sentMessages).toHaveLength(1);
    const message = handle.sentMessages[0]!;
    expect(message).toContain('https://mostaql.com/project/p-qualified');
    expect(message).toContain('مشروع مؤهل');
    expect(message).toContain('/100');
  });

  it('does not process duplicate projects or resend notifications on a repeat scan', async () => {
    handle = build();
    await handle.container.scan.trigger('manual');
    expect(handle.sentMessages).toHaveLength(1);

    const second = await handle.container.scan.trigger('manual');
    expect(second.newCount).toBe(0);
    expect(second.duplicates).toBe(4);
    expect(second.analyzed).toBe(0);
    // No new opportunity notifications.
    expect(handle.sentMessages).toHaveLength(1);
  });

  it('re-analyses and re-notifies when project content meaningfully changes', async () => {
    const details = setupDetails();
    const listing = [makeListing('p-qualified', 'مشروع مؤهل')];
    handle = buildTestContainer({
      source: createFakeSource(listing, details),
      openai: makeAnalyzer({ 'مشروع مؤهل': makeEvaluationCall().result }),
      config: { SCRAPER_DETAIL_REFRESH_HOURS: 0 },
    });

    await handle.container.scan.trigger('manual');
    expect(handle.sentMessages).toHaveLength(1);

    // Meaningful content change on the detail page.
    details['p-qualified'] = makeDetail({
      title: 'مشروع مؤهل',
      description: 'وصف جديد ومختلف تماماً عن السابق مع متطلبات موسعة.',
      budgetRaw: '$500 - $2,500',
    });

    const report = await handle.container.scan.trigger('manual');
    expect(report.newCount).toBe(0);
    expect(report.analyzed).toBe(1);
    expect(handle.sentMessages).toHaveLength(2);
  });

  it('records a scan log row for each scan', async () => {
    handle = build();
    await handle.container.scan.trigger('manual');
    const rows = handle.container.db.select().from(scanLogs).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.newCount).toBe(4);
    expect(rows[0]!.status).toBe('success');
  });
});