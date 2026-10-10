import { eq, sql } from 'drizzle-orm';
import type { AppDb } from '../database/client.js';
import { systemSettings } from '../database/schema.js';
import { nowIso } from '../utils/date.js';

export class SystemSettingsService {
  constructor(private readonly db: AppDb) {}

  get(key: string): string | null {
    const row = this.db.select().from(systemSettings).where(eq(systemSettings.key, key)).get();
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    const now = nowIso();
    this.db
      .insert(systemSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: now },
      })
      .run();
  }

  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  /** Atomically claim an absent or expired lock using a conditional SQLite UPSERT. */
  tryAcquireScanLock(owner: string, ttlMs: number): boolean {
    const now = Date.now();
    const value = JSON.stringify({
      owner,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    });
    const updatedAt = nowIso();
    const acquired = this.db
      .insert(systemSettings)
      .values({ key: SCAN_LOCK_KEY, value, updatedAt })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt },
        setWhere: sql`json_valid(${systemSettings.value}) AND json_extract(${systemSettings.value}, '$.expiresAt') <= ${new Date(now).toISOString()}`,
      })
      .returning({ key: systemSettings.key })
      .get();
    return acquired !== undefined;
  }

  /** Release only a lock still owned by this worker (avoids deleting a replacement lock). */
  clearExpiredScanLock(now: number): boolean {
    const rows = this.db.delete(systemSettings).where(
      sql`${systemSettings.key} = ${SCAN_LOCK_KEY} AND json_valid(${systemSettings.value}) AND json_extract(${systemSettings.value}, '$.expiresAt') <= ${new Date(now).toISOString()}`,
    ).returning({ key: systemSettings.key }).all();
    return rows.length > 0;
  }

  releaseScanLock(owner: string): void {
    this.db.delete(systemSettings).where(
      sql`${systemSettings.key} = ${SCAN_LOCK_KEY} AND json_valid(${systemSettings.value}) AND json_extract(${systemSettings.value}, '$.owner') = ${owner}`,
    ).run();
  }

  delete(key: string): void {
    this.db.delete(systemSettings).where(eq(systemSettings.key, key)).run();
  }
}

export interface ScanLock {
  owner: string;
  startedAt: string;
  expiresAt: string;
}

export const SCAN_LOCK_KEY = 'scan_lock';

export class ScanLockService {
  constructor(private readonly settings: SystemSettingsService) {}

  private readLock(): ScanLock | null {
    return this.settings.getJson<ScanLock | null>(SCAN_LOCK_KEY, null);
  }

  isExpired(lock: ScanLock, now = Date.now()): boolean {
    return new Date(lock.expiresAt).getTime() <= now;
  }

  /** SQLite conditional upsert is atomic across workers sharing this database. */
  acquire(owner: string, ttlMs: number): boolean {
    return this.settings.tryAcquireScanLock(owner, ttlMs);
  }

  release(owner: string): void {
    this.settings.releaseScanLock(owner);
  }

  current(): ScanLock | null {
    return this.readLock();
  }

  /** Clears an expired lock left behind by a crash. Returns true if cleared. */
  recoverExpired(now = Date.now()): boolean {
    return this.settings.clearExpiredScanLock(now);
  }
}
