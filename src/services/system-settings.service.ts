import { eq } from 'drizzle-orm';
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

  /** Attempts to acquire the scan lock. Prevents concurrent scans. */
  acquire(owner: string, ttlMs: number): boolean {
    const existing = this.readLock();
    if (existing && !this.isExpired(existing)) {
      return false;
    }
    const now = Date.now();
    this.settings.setJson(SCAN_LOCK_KEY, {
      owner,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    } satisfies ScanLock);
    return true;
  }

  release(owner: string): void {
    const existing = this.readLock();
    if (existing && existing.owner !== owner) return;
    this.settings.delete(SCAN_LOCK_KEY);
  }

  current(): ScanLock | null {
    return this.readLock();
  }

  /** Clears an expired lock left behind by a crash. Returns true if cleared. */
  recoverExpired(now = Date.now()): boolean {
    const existing = this.readLock();
    if (existing && this.isExpired(existing, now)) {
      this.settings.delete(SCAN_LOCK_KEY);
      return true;
    }
    return false;
  }
}