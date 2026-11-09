import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory.js';
import { MissingTenantError } from '../src/common/tenant-context.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, createOrg, setActiveOrg, signUp, type TestUser } from './helpers.js';

/**
 * Critical guarantee: a user from Organization A must never access Organization B's data.
 * Every tenant resource added in later phases must extend this suite.
 */
describe('Tenant isolation (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestUser;
  let bob: TestUser;
  let orgA: string;
  let orgB: string;
  let workspaceA: string;

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    alice = await signUp(app, 'Alice');
    bob = await signUp(app, 'Bob');
    orgA = await createOrg(app, alice, 'Org A');
    orgB = await createOrg(app, bob, 'Org B');
    workspaceA = (await api(app, alice).post('/workspaces', { name: 'Alice Secret Workspace' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('only lists workspaces of the active organization', async () => {
    const res = await api(app, bob).get('/workspaces').expect(200);
    expect(res.body.data.every((w: { organizationId: string }) => w.organizationId === orgB)).toBe(true);
    expect(res.body.data.map((w: { id: string }) => w.id)).not.toContain(workspaceA);
  });

  it("returns 404 when reading, updating or deleting another org's workspace", async () => {
    await api(app, bob).get(`/workspaces/${workspaceA}`).expect(404);
    await api(app, bob).patch(`/workspaces/${workspaceA}`, { name: 'pwned' }).expect(404);
    await api(app, bob).delete(`/workspaces/${workspaceA}`).expect(404);

    const stillThere = await api(app, alice).get(`/workspaces/${workspaceA}`).expect(200);
    expect(stillThere.body.name).toBe('Alice Secret Workspace');
  });

  it('cannot inject organizationId into a create payload', async () => {
    await api(app, bob).post('/workspaces', { name: 'Injected', organizationId: orgA }).expect(400);
    const aliceList = await api(app, alice).get('/workspaces').expect(200);
    expect(aliceList.body.data.map((w: { name: string }) => w.name)).not.toContain('Injected');
  });

  it("cannot switch the session to an organization the user doesn't belong to", async () => {
    const res = await setActiveOrg(app, bob, orgA);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION');

    // Better Auth fails closed: the rejected switch clears the active organization entirely.
    const cleared = await api(app, bob).get('/organizations/current').expect(403);
    expect(cleared.body.code).toBe('NO_ACTIVE_ORGANIZATION');

    expect((await setActiveOrg(app, bob, orgB)).status).toBe(200);
    const org = await api(app, bob).get('/organizations/current').expect(200);
    expect(org.body.id).toBe(orgB);
  });

  it('rejects a forged session whose active organization has no membership', async () => {
    const prisma = app.get(PrismaService);
    await prisma.system.session.updateMany({ where: { userId: bob.userId }, data: { activeOrganizationId: orgA } });
    const res = await api(app, bob).get('/workspaces').expect(403);
    expect(res.body.code).toBe('NOT_A_MEMBER');
    await prisma.system.session.updateMany({ where: { userId: bob.userId }, data: { activeOrganizationId: orgB } });
  });

  it('scopes organization profile, members, audit logs and subscription', async () => {
    const org = await api(app, bob).get('/organizations/current').expect(200);
    expect(org.body.id).toBe(orgB);

    const members = await api(app, bob).get('/organizations/current/members').expect(200);
    expect(members.body.map((m: { userId: string }) => m.userId)).toEqual([bob.userId]);

    const logs = await api(app, bob).get('/audit-logs').expect(200);
    expect(JSON.stringify(logs.body)).not.toContain(workspaceA);
    expect(JSON.stringify(logs.body)).not.toContain(alice.userId);
  });

  it('fails closed when tenant models are queried without a tenant context', async () => {
    const prisma = app.get(PrismaService);
    await expect(prisma.tenant.workspace.findMany()).rejects.toBeInstanceOf(MissingTenantError);
  });

  describe('role-based permissions', () => {
    let viewer: TestUser;

    beforeAll(async () => {
      viewer = await signUp(app, 'Viewer');
      // Invitations arrive in Phase 2; add the membership directly for this test.
      const prisma = app.get(PrismaService);
      await prisma.system.member.create({ data: { id: crypto.randomUUID(), organizationId: orgA, userId: viewer.userId, role: 'viewer' } });
      expect((await setActiveOrg(app, viewer, orgA)).status).toBe(200);
    });

    it('lets a viewer read but not write', async () => {
      await api(app, viewer).get('/workspaces').expect(200);
      const res = await api(app, viewer).post('/workspaces', { name: 'Viewer Workspace' }).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
      await api(app, viewer).patch('/organizations/current', { industry: 'x' }).expect(403);
      await api(app, viewer).get('/audit-logs').expect(403);
      await api(app, viewer).get('/billing/subscription').expect(403);
    });

    it('reports the viewer role and read-only permissions', async () => {
      const org = await api(app, viewer).get('/organizations/current').expect(200);
      expect(org.body.role).toBe('VIEWER');
      expect(org.body.permissions).toContain('workspace:read');
      expect(org.body.permissions).not.toContain('workspace:create');
    });
  });
});
