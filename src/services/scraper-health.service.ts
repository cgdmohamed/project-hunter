import type { BlockReason } from '../integrations/http.js';
import type { Metrics } from '../utils/metrics.js';
import type { SystemSettingsService } from './system-settings.service.js';

const BLOCKED_KEY = 'scraper_blocked';
const STRUCTURE_KEY = 'structure_mismatch_count';

export interface BlockState {
  reason: BlockReason;
  status: number | null;
  at: string;
}

export class ScraperHealthService {
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly metrics: Metrics,
    private readonly alertThreshold: number,
  ) {}

  getBlockState(): BlockState | null {
    return this.settings.getJson<BlockState | null>(BLOCKED_KEY, null);
  }

  isBlocked(): boolean {
    return this.getBlockState() !== null;
  }

  setBlocked(reason: BlockReason, status: number | null, at = new Date().toISOString()): void {
    this.settings.setJson(BLOCKED_KEY, { reason, status, at } satisfies BlockState);
    this.metrics.markScraperBlocked(new Date(at).getTime());
  }

  clearBlocked(): void {
    this.settings.delete(BLOCKED_KEY);
  }

  structureMismatchCount(): number {
    const raw = this.settings.get(STRUCTURE_KEY);
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  recordStructureMismatch(): void {
    const count = this.structureMismatchCount() + 1;
    this.settings.set(STRUCTURE_KEY, String(count));
    this.metrics.structureMismatches = count;
  }

  resetStructureMismatch(): void {
    this.settings.delete(STRUCTURE_KEY);
    this.metrics.structureMismatches = 0;
  }

  /** True when consecutive structure mismatches crossed the alert threshold. */
  shouldStructureAlert(): boolean {
    return this.structureMismatchCount() >= this.alertThreshold;
  }
}