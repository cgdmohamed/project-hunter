import { count, desc, eq, sql, type Column } from 'drizzle-orm';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { analyses, notifications, projects, proposals, scanLogs } from './database/schema.js';
import type { Container } from './container.js';
import { PROJECT_STATUSES, type ProjectStatus } from './types/project.js';

export interface AppContext {
  container: Container;
  ready: { dbMigrated: boolean };
}

export function createApp(ctx: AppContext): FastifyInstance {
  const { container } = ctx;
  const app = Fastify({ logger: false, disableRequestLogging: true });

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = request.headers['x-api-key'];
    if (typeof key !== 'string' || key !== container.config.ADMIN_API_KEY) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    container.logger.error(
      { error: error.message, statusCode: error.statusCode },
      'request failed',
    );
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    void reply.code(status).send({ error: status === 500 ? 'internal_error' : error.message });
  });

  // ---- Health ---------------------------------------------------------
  app.get('/health', async (_request, reply) => {
    try {
      container.sqlite.prepare('SELECT 1').get();
    } catch {
      return reply.code(503).send({ status: 'error', checks: { database: 'error' } });
    }
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      checks: { database: 'ok' },
    };
  });

  app.get('/ready', async (_request, reply) => {
    const checks = {
      database: safeDbCheck(container),
      migrations: ctx.ready.dbMigrated,
      openaiConfigured: Boolean(container.config.OPENAI_API_KEY),
      telegramConfigured: Boolean(
        container.config.TELEGRAM_BOT_TOKEN && container.config.TELEGRAM_CHAT_ID,
      ),
      scraperEnabled: container.config.SCRAPER_ENABLED,
      scraperBlocked: container.health.isBlocked(),
    };
    const ready = checks.database && checks.migrations;
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });

  // ---- Stats ----------------------------------------------------------
  app.get('/stats', async () => {
    const statusCounts = container.repo.countByStatus();
    const tokenRow = container.db
      .select({
        inputTokens: sql_sum(analyses.inputTokens),
        outputTokens: sql_sum(analyses.outputTokens),
        estimatedCost: sql_sum(analyses.estimatedCost),
        analyzed: count(),
      })
      .from(analyses)
      .get();

    const notificationRows = container.db
      .select({ status: notifications.status, total: count() })
      .from(notifications)
      .groupBy(notifications.status)
      .all();
    const notificationsByStatus: Record<string, number> = {};
    for (const row of notificationRows) notificationsByStatus[row.status] = Number(row.total);

    const recentScans = container.db
      .select()
      .from(scanLogs)
      .orderBy(desc(scanLogs.id))
      .limit(5)
      .all();

    const blockState = container.health.getBlockState();

    return {
      generatedAt: new Date().toISOString(),
      runtime: container.metrics.snapshot(),
      projects: {
        total: container.repo.total(),
        byStatus: statusCounts,
      },
      openai: {
        analyzedTotal: Number(tokenRow?.analyzed ?? 0),
        inputTokens: Number(tokenRow?.inputTokens ?? 0),
        outputTokens: Number(tokenRow?.outputTokens ?? 0),
        estimatedCostUsd: Math.round(Number(tokenRow?.estimatedCost ?? 0) * 10000) / 10000,
        model: container.config.OPENAI_MODEL,
      },
      notifications: notificationsByStatus,
      scraper: {
        enabled: container.config.SCRAPER_ENABLED,
        blocked: blockState !== null,
        blockState,
        structureMismatchCount: container.health.structureMismatchCount(),
        scanLock: container.lock.current(),
        scanning: container.scan.isRunning,
      },
      recentScans,
    };
  });

  // ---- Internal admin API --------------------------------------------
  app.get('/internal/projects', { preHandler: requireAdmin }, async (request) => {
    const query = request.query as { status?: string; limit?: string; offset?: string };
    const status =
      query.status && (PROJECT_STATUSES as readonly string[]).includes(query.status)
        ? query.status
        : undefined;
    const limit = query.limit ? Number(query.limit) : 50;
    const offset = query.offset ? Number(query.offset) : 0;
    const rows = container.repo.list({ status, limit, offset });
    return {
      count: rows.length,
      total: container.repo.total(),
      items: rows.map(toProjectSummary),
    };
  });

  app.get('/internal/projects/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    const project = container.repo.getById(id);
    if (!project) return reply.code(404).send({ error: 'not found' });

    const projectAnalyses = container.db
      .select()
      .from(analyses)
      .where(eq(analyses.projectId, id))
      .orderBy(desc(analyses.id))
      .all();
    const projectProposals = container.db
      .select()
      .from(proposals)
      .where(eq(proposals.projectId, id))
      .orderBy(desc(proposals.id))
      .all();
    const projectNotifications = container.db
      .select()
      .from(notifications)
      .where(eq(notifications.projectId, id))
      .orderBy(desc(notifications.id))
      .all();

    return { project, analyses: projectAnalyses, proposals: projectProposals, notifications: projectNotifications };
  });

  app.post('/internal/scan', { preHandler: requireAdmin }, async (_request, reply) => {
    const report = await container.scan.trigger('manual');
    return reply.code(report.status === 'skipped' ? 409 : 200).send(report);
  });

  app.post('/internal/projects/:id/reanalyze', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    const result = await container.scan.reanalyzeProject(id);
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  app.post(
    '/internal/projects/:id/regenerate-proposal',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
      const result = await container.scan.regenerateProposal(id);
      return reply.code(result.ok ? 200 : 400).send(result);
    },
  );

  app.patch('/internal/projects/:id/status', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    const body = request.body as { status?: string } | undefined;
    const status = body?.status;
    if (!status || !(PROJECT_STATUSES as readonly string[]).includes(status)) {
      return reply.code(400).send({ error: 'invalid status', allowed: PROJECT_STATUSES });
    }
    const project = container.repo.getById(id);
    if (!project) return reply.code(404).send({ error: 'not found' });
    container.repo.updateStatus(id, status as ProjectStatus);
    return { ok: true, id, status };
  });

  app.post('/internal/scraper/unblock', { preHandler: requireAdmin }, async () => {
    container.scan.unblockScraper();
    return { ok: true, blocked: container.health.isBlocked() };
  });

  return app;
}

function safeDbCheck(container: Container): boolean {
  try {
    container.sqlite.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

function sql_sum(column: Column) {
  return sql<number>`coalesce(sum(${column}), 0)`;
}

function toProjectSummary(project: typeof projects.$inferSelect) {
  return {
    id: project.id,
    source: project.source,
    externalId: project.externalId,
    canonicalUrl: project.canonicalUrl,
    title: project.title,
    status: project.status,
    budgetMinUsd: project.budgetMinUsd,
    budgetMaxUsd: project.budgetMaxUsd,
    originalCurrency: project.originalCurrency,
    publishedAt: project.publishedAt,
    proposalCount: project.proposalCount,
    firstSeenAt: project.firstSeenAt,
    lastSeenAt: project.lastSeenAt,
  };
}