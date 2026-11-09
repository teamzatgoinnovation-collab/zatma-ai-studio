import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory.js';
import { api, createOrg, signUp, type TestUser } from './helpers.js';

describe('Foundation (e2e)', () => {
  let app: NestExpressApplication;
  let owner: TestUser;

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    owner = await signUp(app, 'Owner');
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy database and redis', async () => {
    const res = await api(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer() as Server).get('/api/docs-json').expect(200);
    expect(res.body.info.title).toBe('ZatGo AI Marketing API');
    expect(Object.keys(res.body.paths)).toContain('/api/v1/workspaces');
  });

  it('serves the public plan catalogue', async () => {
    const res = await api(app).get('/billing/plans').expect(200);
    expect(res.body.map((p: { code: string }) => p.code)).toEqual(['FREE', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'AGENCY']);
  });

  it('rejects unauthenticated requests with the error envelope', async () => {
    const res = await api(app).get('/workspaces').expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED', path: '/api/v1/workspaces' });
    expect(res.body.timestamp).toBeTypeOf('string');
  });

  it('requires an active organization for tenant routes', async () => {
    await api(app, owner).get('/users/me').expect(200);
    const res = await api(app, owner).get('/workspaces').expect(403);
    expect(res.body.code).toBe('NO_ACTIVE_ORGANIZATION');
  });

  it('provisions a new organization with default workspace, Free plan and audit entry', async () => {
    const orgId = await createOrg(app, owner, 'ZatGo Innovation');

    const org = await api(app, owner).get('/organizations/current').expect(200);
    expect(org.body).toMatchObject({ id: orgId, role: 'ORGANIZATION_OWNER', currency: 'INR', subscription: { status: 'ACTIVE', plan: { code: 'FREE' } } });

    const ws = await api(app, owner).get('/workspaces').expect(200);
    expect(ws.body.meta.total).toBe(1);
    expect(ws.body.data[0]).toMatchObject({ isDefault: true, organizationId: orgId });

    const me = await api(app, owner).get('/users/me').expect(200);
    expect(me.body.activeOrganizationId).toBe(orgId);
    expect(me.body.memberships).toHaveLength(1);

    const logs = await api(app, owner).get('/audit-logs').expect(200);
    expect(logs.body.data.map((l: { action: string }) => l.action)).toContain('organization.created');
  });

  it('restores the active organization on a new sign-in', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/auth/sign-in/email')
      .set('Origin', 'http://localhost:3000')
      .send({ email: owner.email, password: 'supersecret123' })
      .expect(200);
    const cookie = ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]).join('; ');
    const org = await api(app, { ...owner, cookie }).get('/organizations/current').expect(200);
    expect(org.body.role).toBe('ORGANIZATION_OWNER');
  });

  it('performs workspace CRUD with validation and audit logging', async () => {
    const created = await api(app, owner).post('/workspaces', { name: 'Kerala Retail', description: 'Supermarkets' }).expect(201);
    const id = created.body.id as string;

    await api(app, owner).get(`/workspaces/${id}`).expect(200);
    const updated = await api(app, owner).patch(`/workspaces/${id}`, { name: 'Kerala Retail Chains' }).expect(200);
    expect(updated.body.name).toBe('Kerala Retail Chains');

    const invalid = await api(app, owner).post('/workspaces', { name: 'x' }).expect(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');

    await api(app, owner).delete(`/workspaces/${id}`).expect(204);
    await api(app, owner).get(`/workspaces/${id}`).expect(404);

    const logs = await api(app, owner).get('/audit-logs').expect(200);
    const actions = logs.body.data.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['workspace.created', 'workspace.updated', 'workspace.deleted']));
  });

  it('refuses to delete the default workspace', async () => {
    const ws = await api(app, owner).get('/workspaces').expect(200);
    const def = ws.body.data.find((w: { isDefault: boolean }) => w.isDefault);
    const res = await api(app, owner).delete(`/workspaces/${def.id}`).expect(409);
    expect(res.body.code).toBe('DEFAULT_WORKSPACE');
  });

  it('updates the organization profile with validated fields only', async () => {
    const res = await api(app, owner)
      .patch('/organizations/current', { industry: 'Software', timezone: 'Asia/Dubai', currency: 'AED', defaultLanguage: 'ml' })
      .expect(200);
    expect(res.body).toMatchObject({ industry: 'Software', timezone: 'Asia/Dubai', currency: 'AED', defaultLanguage: 'ml' });
    await api(app, owner).patch('/organizations/current', { slug: 'hijack' }).expect(400);
  });

  it('lists AI providers without exposing keys', async () => {
    const res = await api(app, owner).get('/ai/providers').expect(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual(['openai', 'anthropic', 'gemini']);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-|apiKey/i);
  });

  it('validates storage upload requests', async () => {
    const res = await api(app, owner).post('/storage/uploads', { fileName: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    const ok = await api(app, owner).post('/storage/uploads', { fileName: 'logo.png', mimeType: 'image/png', sizeBytes: 2048, purpose: 'LOGO' }).expect(201);
    expect(ok.body.key).toMatch(/^org\/[0-9a-f-]+\/logo\/[0-9a-f-]+\.png$/);
    expect(ok.body.uploadUrl).toContain('X-Amz-Signature');
  });
});
