import { afterEach, describe, expect, it } from 'vitest';
import { BlockedAccessError } from '../../src/integrations/http.js';
import type { ProjectSource } from '../../src/sources/project-source.interface.js';
import { buildTestContainer, type TestContainerHandle } from '../support/testkit.js';

function blockedSource(): ProjectSource {
  return {
    name: 'mostaql',
    discoverProjects: async () => {
      throw new BlockedAccessError('http403', 403, 'forbidden');
    },
    fetchProjectDetail: async () => {
      throw new Error('should not be called');
    },
    checkAccess: async () => ({ reachable: false, status: 403, robotsAllowsListing: true, robotsRaw: null, notes: ['blocked'] }),
  };
}

describe('scraper shutdown on explicit blocking', () => {
  let handle: TestContainerHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it('stops the scan, alerts the administrator and refuses further scraping', async () => {
    let discoveryAttempts = 0;
    const source: ProjectSource = {
      ...blockedSource(),
      discoverProjects: async () => {
        discoveryAttempts += 1;
        throw new BlockedAccessError('http403', 403, 'forbidden');
      },
    };
    handle = buildTestContainer({ source });

    const first = await handle.container.scan.trigger('manual');
    expect(first.status).toBe('failed');
    expect(first.blocked).toBe(true);
    expect(handle.container.health.isBlocked()).toBe(true);
    expect(handle.metrics.mostaqlBlocked).toBe(1);
    // The administrator received a technical alert.
    expect(handle.sentMessages.length).toBeGreaterThan(0);
    expect(handle.sentMessages[0]!).toContain('تم إيقاف جمع البيانات');

    const skipped = await handle.container.scan.trigger('manual');
    expect(skipped.status).toBe('skipped');
    expect(skipped.skippedReason).toBe('scraper_blocked');
    // No new discovery attempts happened after blocking.
    expect(discoveryAttempts).toBe(1);

    // Administrator clears the block manually.
    handle.container.scan.unblockScraper();
    expect(handle.container.health.isBlocked()).toBe(false);
  });
});