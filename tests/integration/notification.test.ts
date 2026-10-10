import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTestContainer,
  createFakeSource,
  makeAnalyzer,
  makeDetail,
  makeEvaluationCall,
  makeListing,
  type TestContainerHandle,
} from '../support/testkit.js';

describe('notification delivery', () => {
  let handle: TestContainerHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  function oneQualifiedProject() {
    return buildTestContainer({
      source: createFakeSource(
        [makeListing('p-1', 'مشروع واحد')],
        { 'p-1': makeDetail({ title: 'مشروع واحد', budgetRaw: '$800 - $1,500' }) },
      ),
      openai: makeAnalyzer({ 'مشروع واحد': makeEvaluationCall().result }),
    });
  }

  it('is idempotent: repeated scans do not resend the same project version', async () => {
    handle = oneQualifiedProject();
    await handle.container.scan.trigger('manual');
    expect(handle.sentMessages).toHaveLength(1);

    const reprocessed = await handle.container.notification.sendOpportunity(
      handle.container.repo.list({ limit: 10 })[0]!,
      handle.container.repo.latestAnalysis(handle.container.repo.list({ limit: 10 })[0]!.id)!,
      handle.container.repo.latestProposal(handle.container.repo.list({ limit: 10 })[0]!.id)!,
    );
    expect(reprocessed.status).toBe('skipped');
    expect(handle.sentMessages).toHaveLength(1);
  });

  it('marks delivery failures as notification_failed and retries on the next scan', async () => {
    handle = oneQualifiedProject();
    handle.telegram.setFailNext(1); // first send fails

    const first = await handle.container.scan.trigger('manual');
    expect(first.status).toBe('success');
    const project = handle.container.repo.list({ limit: 10 })[0]!;
    expect(project.status).toBe('notification_failed');
    expect(handle.metrics.notificationFailures).toBe(1);
    expect(handle.sentMessages).toHaveLength(0);

    // Next scan retries delivery without re-running the AI analysis.
    const second = await handle.container.scan.trigger('manual');
    expect(second.analyzed).toBe(0);
    expect(second.notified).toBe(1);
    const afterRetry = handle.container.repo.getById(project.id)!;
    expect(afterRetry.status).toBe('notified');
    expect(handle.sentMessages).toHaveLength(1);
  });
});