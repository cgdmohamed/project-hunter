import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  buildTestContainer,
  createFakeSource,
  makeAnalyzer,
  makeDetail,
  makeEvaluationCall,
  makeListing,
  type TestContainerHandle,
} from '../support/testkit.js';

describe('HTTP API', () => {
  let handle: TestContainerHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  function createTestApp() {
    handle = buildTestContainer({});
    return { app: createApp({ container: handle.container, ready: { dbMigrated: true } }), handle };
  }

  it('exposes health and readiness', async () => {
    const { app: fastify } = createTestApp();
    const health = await fastify.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');
    expect(health.json().checks.database).toBe('ok');

    const ready = await fastify.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().ready).toBe(true);
  });

  it('does not leak secrets from health endpoints', async () => {
    const { app: fastify } = createTestApp();
    const raw = await fastify.inject({ method: 'GET', url: '/health' });
    const text = raw.body;
    expect(text).not.toContain('test-openai-key');
    expect(text).not.toContain('test-admin-key');
    expect(text).not.toContain('test-token');
  });

  it('protects internal routes with the admin key', async () => {
    const { app: fastify } = createTestApp();
    const unauthorized = await fastify.inject({ method: 'GET', url: '/internal/projects' });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await fastify.inject({
      method: 'GET',
      url: '/internal/projects',
      headers: { 'x-api-key': 'test-admin-key' },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().items).toEqual([]);
  });

  it('supports the full scan lifecycle through the internal API', async () => {
    handle = buildTestContainer({
      source: createFakeSource(
        [makeListing('api-1', 'مشروع عبر API')],
        { 'api-1': makeDetail({ title: 'مشروع عبر API', budgetRaw: '$700 - $1,200' }) },
      ),
      openai: makeAnalyzer({ 'مشروع عبر API': makeEvaluationCall().result }),
    });
    const app = createApp({ container: handle.container, ready: { dbMigrated: true } });
    const key = { 'x-api-key': 'test-admin-key' };

    const scan = await app.inject({ method: 'POST', url: '/internal/scan', headers: key });
    expect(scan.statusCode).toBe(200);
    expect(scan.json().newCount).toBe(1);
    expect(scan.json().status).toBe('success');

    const list = await app.inject({ method: 'GET', url: '/internal/projects', headers: key });
    expect(list.statusCode).toBe(200);
    const id = list.json().items[0]!.id;

    const detail = await app.inject({ method: 'GET', url: `/internal/projects/${id}`, headers: key });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().analyses.length).toBe(1);
    expect(detail.json().proposals.length).toBe(1);
    expect(detail.json().notifications.length).toBe(1);

    const badStatus = await app.inject({
      method: 'PATCH',
      url: `/internal/projects/${id}/status`,
      headers: key,
      payload: { status: 'not-a-status' },
    });
    expect(badStatus.statusCode).toBe(400);

    const goodStatus = await app.inject({
      method: 'PATCH',
      url: `/internal/projects/${id}/status`,
      headers: key,
      payload: { status: 'manually_applied' },
    });
    expect(goodStatus.statusCode).toBe(200);
    expect(goodStatus.json().status).toBe('manually_applied');

    await app.close();
  });

  it('returns meaningless stats without exposing credentials', async () => {
    const { app: fastify } = createTestApp();
    const stats = await fastify.inject({ method: 'GET', url: '/stats' });
    expect(stats.statusCode).toBe(200);
    const body = stats.json();
    expect(body).toHaveProperty('projects');
    expect(body).toHaveProperty('runtime');
    expect(JSON.stringify(body)).not.toContain('test-admin-key');
  });
});