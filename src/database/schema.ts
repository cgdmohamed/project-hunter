import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    title: text('title'),
    description: text('description'),
    category: text('category'),
    skills: text('skills'),
    originalCurrency: text('original_currency'),
    budgetMin: real('budget_min'),
    budgetMax: real('budget_max'),
    budgetMinUsd: real('budget_min_usd'),
    budgetMaxUsd: real('budget_max_usd'),
    publishedAt: text('published_at'),
    expectedDuration: text('expected_duration'),
    projectStatus: text('project_status'),
    proposalCount: integer('proposal_count'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    contentHash: text('content_hash').notNull(),
    listingFingerprint: text('listing_fingerprint'),
    detailFetchedAt: text('detail_fetched_at'),
    status: text('status').notNull().default('discovered'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sourceExternalUnique: uniqueIndex('projects_source_external_id_uq').on(
      table.source,
      table.externalId,
    ),
    statusIdx: index('projects_status_idx').on(table.status),
    canonicalUrlIdx: index('projects_canonical_url_idx').on(table.canonicalUrl),
  }),
);

export const analyses = sqliteTable(
  'analyses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    category: text('category'),
    summary: text('summary'),
    businessProblem: text('business_problem'),
    technicalSuitability: text('technical_suitability'),
    suitabilityReasons: text('suitability_reasons'),
    financialViability: text('financial_viability'),
    risks: text('risks'),
    missingRequirements: text('missing_requirements'),
    clarificationQuestions: text('clarification_questions'),
    recommendedApproach: text('recommended_approach'),
    estimatedDuration: text('estimated_duration'),
    recommendedPrice: text('recommended_price'),
    confidence: real('confidence'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCost: real('estimated_cost'),
    contentHash: text('content_hash'),
    analyzedAt: text('analyzed_at').notNull(),
  },
  (table) => ({
    projectIdx: index('analyses_project_id_idx').on(table.projectId),
  }),
);

export const proposals = sqliteTable(
  'proposals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    language: text('language').notNull().default('ar'),
    proposalText: text('proposal_text').notNull(),
    recommendedPrice: text('recommended_price'),
    estimatedDuration: text('estimated_duration'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    projectIdx: index('proposals_project_id_idx').on(table.projectId),
  }),
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    channel: text('channel').notNull().default('telegram'),
    notificationType: text('notification_type').notNull().default('opportunity'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    telegramMessageId: integer('telegram_message_id'),
    dedupKey: text('dedup_key').notNull(),
    sentAt: text('sent_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    dedupUnique: uniqueIndex('notifications_dedup_key_uq').on(table.dedupKey),
    projectIdx: index('notifications_project_id_idx').on(table.projectId),
  }),
);

export const scanLogs = sqliteTable(
  'scan_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    durationMs: integer('duration_ms'),
    discoveredCount: integer('discovered_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    analyzedCount: integer('analyzed_count').notNull().default(0),
    qualifiedCount: integer('qualified_count').notNull().default(0),
    budgetRejectedCount: integer('budget_rejected_count').notNull().default(0),
    needsReviewCount: integer('needs_review_count').notNull().default(0),
    notifiedCount: integer('notified_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    status: text('status').notNull().default('running'),
    errorMessage: text('error_message'),
  },
  (table) => ({
    startedIdx: index('scan_logs_started_at_idx').on(table.startedAt),
  }),
);

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type AnalysisRow = typeof analyses.$inferSelect;
export type NewAnalysisRow = typeof analyses.$inferInsert;
export type ProposalRow = typeof proposals.$inferSelect;
export type NewProposalRow = typeof proposals.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type ScanLogRow = typeof scanLogs.$inferSelect;
export type NewScanLogRow = typeof scanLogs.$inferInsert;
export type SystemSettingRow = typeof systemSettings.$inferSelect;
