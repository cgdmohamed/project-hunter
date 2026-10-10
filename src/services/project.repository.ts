import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '../database/client.js';
import { analyses, projects, proposals, type NewProjectRow, type ProjectRow } from '../database/schema.js';
import type { NormalizedProject, ProjectStatus } from '../types/project.js';
import { nowIso } from '../utils/date.js';

export class ProjectRepository {
  constructor(private readonly db: AppDb) {}

  findBySourceExternalId(source: string, externalId: string): ProjectRow | undefined {
    return this.db
      .select()
      .from(projects)
      .where(and(eq(projects.source, source), eq(projects.externalId, externalId)))
      .get();
  }

  getById(id: number): ProjectRow | undefined {
    return this.db.select().from(projects).where(eq(projects.id, id)).get();
  }

  list(options: { status?: string; limit?: number; offset?: number } = {}): ProjectRow[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const base = this.db.select().from(projects);
    const query = options.status
      ? base.where(eq(projects.status, options.status))
      : base;
    return query.orderBy(desc(projects.id)).limit(limit).offset(offset).all();
  }

  countByStatus(): Record<string, number> {
    const rows = this.db
      .select({ status: projects.status, total: count() })
      .from(projects)
      .groupBy(projects.status)
      .all();
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = Number(row.total);
    return result;
  }

  total(): number {
    const row = this.db.select({ total: count() }).from(projects).get();
    return Number(row?.total ?? 0);
  }

  insertDiscovered(input: {
    source: string;
    externalId: string;
    canonicalUrl: string;
    title: string | null;
    listingFingerprint: string;
    contentHash: string;
  }): ProjectRow {
    const now = nowIso();
    const values: NewProjectRow = {
      source: input.source,
      externalId: input.externalId,
      canonicalUrl: input.canonicalUrl,
      title: input.title,
      listingFingerprint: input.listingFingerprint,
      contentHash: input.contentHash,
      firstSeenAt: now,
      lastSeenAt: now,
      status: 'discovered',
      updatedAt: now,
    };
    return this.db.insert(projects).values(values).returning().get();
  }

  /** Updates listing-level info without touching detail fields. */
  touchFromListing(
    id: number,
    data: { title: string | null; listingFingerprint: string; lastSeenAt: string },
  ): void {
    this.db
      .update(projects)
      .set({
        title: data.title,
        listingFingerprint: data.listingFingerprint,
        lastSeenAt: data.lastSeenAt,
        updatedAt: nowIso(),
      })
      .where(eq(projects.id, id))
      .run();
  }

  /**
   * Applies a freshly parsed detail to a project. Returns the previous
   * contentHash so callers can detect meaningful changes.
   */
  applyDetail(
    id: number,
    normalized: NormalizedProject,
    options: { markPendingAnalysis: boolean },
  ): { previousHash: string | null } {
    const previous = this.getById(id);
    const previousHash = previous?.contentHash ?? null;
    const now = nowIso();

    const sets: Partial<NewProjectRow> = {
      title: normalized.title,
      description: normalized.description,
      category: normalized.category,
      skills: normalized.skills === null ? null : JSON.stringify(normalized.skills),
      originalCurrency: normalized.originalCurrency,
      budgetMin: normalized.budgetMin,
      budgetMax: normalized.budgetMax,
      budgetMinUsd: normalized.budgetMinUsd,
      budgetMaxUsd: normalized.budgetMaxUsd,
      publishedAt: normalized.publishedAt,
      expectedDuration: normalized.expectedDuration,
      projectStatus: normalized.projectStatus,
      proposalCount: normalized.proposalCount,
      contentHash: normalized.contentHash,
      detailFetchedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    };
    if (options.markPendingAnalysis) {
      sets.status = 'pending_analysis';
    }

    this.db.update(projects).set(sets).where(eq(projects.id, id)).run();
    return { previousHash };
  }

  updateStatus(id: number, status: ProjectStatus): void {
    this.db
      .update(projects)
      .set({ status, updatedAt: nowIso() })
      .where(eq(projects.id, id))
      .run();
  }

  /** Projects eligible for the AI pipeline within a scan. */
  findProcessable(limit: number): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(inArray(projects.status, ['pending_analysis']))
      .orderBy(projects.id)
      .limit(limit)
      .all();
  }

  findByStatus(status: string, limit = 50): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.status, status))
      .orderBy(projects.id)
      .limit(limit)
      .all();
  }

  /** Newly discovered projects that still need a detail fetch. */
  findNeedingDetail(): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.status, 'discovered'))
      .all();
  }

  latestAnalysis(projectId: number) {
    return this.db
      .select()
      .from(analyses)
      .where(eq(analyses.projectId, projectId))
      .orderBy(desc(analyses.id))
      .get();
  }

  latestProposal(projectId: number) {
    return this.db
      .select()
      .from(proposals)
      .where(eq(proposals.projectId, projectId))
      .orderBy(desc(proposals.id))
      .get();
  }
}