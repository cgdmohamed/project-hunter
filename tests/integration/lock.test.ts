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
import { ScanLockService } from '../../src/services/system-settings.service.js';

describe('scan lock / overlap prevention', () => {
  let handle: TestContainerHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it('acquires, holds, releases and recovers expired locks', () => {
    handle = buildTestContainer();
    const lock = new ScanLockService(handle.container.settings);

    expect(lock.acquire('a', 60_000)).toBe(true);
    expect(lock.acquire('b', 60_000)).toBe(false); // held
    lock.release('a');
    expect(lock.acquire('c', 60_000)).toBe(true);

    // Simulate a crashed scanner leaving an expired lock behind.
    lock.release('c');
    handle.container.settings.setJson('scan_lock', {
      owner: 'dead',
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(lock.recoverExpired()).toBe(true);
    expect(lock.acquire('d', 60_000)).toBe(true);
  });

  it('prevents concurrent scan executions', async () => {
    handle = buildTestContainer({
      source: createFakeSource(
        [makeListing('p-1', 'مشروع')],
        { 'p-1': makeDetail({ title: 'مشروع', budgetRaw: '$500 - $900' }) },
      ),
      openai: makeAnalyzer({ 'مشروع': makeEvaluationCall().result }),
    });

    const [a, b] = await Promise.all([
      handle.container.scan.trigger('manual'),
      handle.container.scan.trigger('manual'),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain('skipped');
    expect(statuses).toContain('success');
  });
});