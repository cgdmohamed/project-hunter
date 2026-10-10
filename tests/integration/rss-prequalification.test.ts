import { afterEach, describe, expect, it } from 'vitest';
import { buildTestContainer, createFakeSource, makeAnalyzer, makeDetail, makeEvaluationCall, makeListing, type TestContainerHandle } from '../support/testkit.js';

describe('RSS opportunities without published budgets', () => {
  let handle: TestContainerHandle | null = null;
  afterEach(() => { handle?.close(); handle = null; });

  it('alerts for high-fit unknown-budget projects without generating a proposal or repeating AI analysis', async () => {
    handle = buildTestContainer({
      config: { RSS_FEED_URL: 'https://rss.app/feeds/example.xml' },
      source: createFakeSource(
        [makeListing('p-1', 'CRM dashboard')],
        { 'p-1': makeDetail({ title: 'CRM dashboard', budgetRaw: null }) },
      ),
      openai: makeAnalyzer({ 'CRM dashboard': makeEvaluationCall().result }),
    });
    const first = await handle.container.scan.trigger('manual');
    expect(first.analyzed).toBe(1);
    expect(first.needsReview).toBe(1);
    expect(first.notified).toBe(1);
    expect(handle.sentMessages).toHaveLength(1);
    expect(handle.sentMessages[0]).toContain('شوف إذا مناسب ليك');
    const project = handle.container.repo.list()[0]!;
    expect(project.status).toBe('needs_review');
    expect(handle.container.repo.latestProposal(project.id)).toBeUndefined();
    const second = await handle.container.scan.trigger('manual');
    expect(second.analyzed).toBe(0);
    expect(handle.sentMessages).toHaveLength(1);
  });

  it('sends low-fit projects for human review rather than rejecting', async () => {
    handle = buildTestContainer({
      config: { RSS_FEED_URL: 'https://rss.app/feeds/example.xml' },
      source: createFakeSource(
        [makeListing('p-2', 'Snapchat account management')],
        { 'p-2': makeDetail({ title: 'Snapchat account management', budgetRaw: null }) },
      ),
      openai: makeAnalyzer({ 'Snapchat account management': makeEvaluationCall({
        criteria: { capabilityMatch: 3, financialViability: 5, requirementsClarity: 10, deliveryFeasibility: 5, riskFactor: 4 },
      }).result }),
    });
    const report = await handle.container.scan.trigger('manual');
    expect(report.analyzed).toBe(1);
    expect(report.notified).toBe(1);
    expect(handle.sentMessages).toHaveLength(1);
    expect(handle.container.repo.list()[0]?.status).toBe('needs_review');
  });
});
