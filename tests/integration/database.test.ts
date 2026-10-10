import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDrizzle, openDatabase, runMigrations } from '../../src/database/client.js';
import { ProjectRepository } from '../../src/services/project.repository.js';

describe('database persistence', () => {
  it('survives a close/reopen cycle (data is not lost)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aph-persist-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      const first = openDatabase(dbPath);
      runMigrations(first);
      const repo = new ProjectRepository(createDrizzle(first));
      repo.insertDiscovered({
        source: 'mostaql',
        externalId: 'persist-1',
        canonicalUrl: 'https://mostaql.com/project/persist-1',
        title: 'مشروع دائم',
        listingFingerprint: 'fp',
        contentHash: 'hash-1',
      });
      expect(repo.total()).toBe(1);
      first.close();

      const second = openDatabase(dbPath);
      const repo2 = new ProjectRepository(createDrizzle(second));
      expect(repo2.total()).toBe(1);
      const row = repo2.findBySourceExternalId('mostaql', 'persist-1');
      expect(row?.title).toBe('مشروع دائم');
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces the unique (source, external_id) constraint at the database level', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aph-dedup-'));
    const dbPath = join(dir, 'test.sqlite');
    try {
      const sqlite = openDatabase(dbPath);
      runMigrations(sqlite);
      const repo = new ProjectRepository(createDrizzle(sqlite));
      const a = repo.insertDiscovered({
        source: 'mostaql',
        externalId: 'dup-1',
        canonicalUrl: 'https://mostaql.com/project/dup-1',
        title: 'أ',
        listingFingerprint: 'x',
        contentHash: 'h1',
      });
      expect(a).toBeTruthy();
      expect(() =>
        repo.insertDiscovered({
          source: 'mostaql',
          externalId: 'dup-1',
          canonicalUrl: 'https://mostaql.com/project/dup-1',
          title: 'أ',
          listingFingerprint: 'x',
          contentHash: 'h1',
        }),
      ).toThrow(/UNIQUE/i);
      sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});