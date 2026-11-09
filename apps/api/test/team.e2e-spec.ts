import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './harness.js';
import { api, auth, createOrg, inviteAndAccept, setActiveOrg, signUp, waitForEmail, type TestUser } from './helpers.js';

describe('Team management (e2e)', () => {
  let app: NestExpressApplication;
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await signUp(app, 'Team Owner');
    orgId = await createOrg(app, owner, 'Team Org');
  });
  afterAll(async () => {
    await app.close();
  });

  it('invites by email, lists the pending invitation and exposes public details', async () => {
    const invitee = await signUp(app, 'Invitee');
    const res = await auth(app).post('/organization/invite-member', { email: invitee.email, role: 'designer', organizationId: orgId }, owner.cookie).expect(200);

    const mail = await waitForEmail(app, invitee.email, 'invitation');
    expect(mail.subject).toContain('Team Org');
    expect(mail.text).toContain(`http://localhost:3000/accept-invitation/${res.body.id}`);
    expect(mail.text).toContain('Designer');

    const pending = await api(app, owner).get('/organizations/current/invitations').expect(200);
    expect(pending.body.map((i: { email: string }) => i.email)).toContain(invitee.email);

    const pub = await api(app).get(`/organizations/invitations/${res.body.id}`).expect(200);
    expect(pub.body).toMatchObject({ organizationName: 'Team Org', role: 'DESIGNER', status: 'pending', inviterName: 'Team Owner' });

    await auth(app).post('/organization/accept-invitation', { invitationId: res.body.id }, invitee.cookie).expect(200);
    await setActiveOrg(app, invitee, orgId);
    const org = await api(app, invitee).get('/organizations/current').expect(200);
    expect(org.body.role).toBe('DESIGNER');

    const logs = await api(app, owner).get('/audit-logs').expect(200);
    expect(logs.body.data.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['member.invited', 'member.joined']));
  });

  it('rejects unknown roles and invitations from non-admins', async () => {
    const x = await signUp(app, 'X');
    const bad = await auth(app).post('/organization/invite-member', { email: x.email, role: 'superuser', organizationId: orgId }, owner.cookie);
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const viewer = await signUp(app, 'Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    const denied = await auth(app).post('/organization/invite-member', { email: x.email, role: 'viewer', organizationId: orgId }, viewer.cookie);
    expect(denied.status).toBe(403);
  });

  it('changes member roles with immediate effect and audits it', async () => {
    const analyst = await signUp(app, 'Analyst');
    await inviteAndAccept(app, owner, analyst, orgId, 'analyst');
    await api(app, analyst).get('/audit-logs').expect(200); // analysts can read audit logs
    await api(app, analyst).post('/workspaces', { name: 'Nope' }).expect(403);

    const members = (await api(app, owner).get('/organizations/current/members').expect(200)).body as Array<{ id: string; userId: string }>;
    const memberId = members.find((m) => m.userId === analyst.userId)!.id;
    await auth(app).post('/organization/update-member-role', { memberId, role: 'marketing_manager', organizationId: orgId }, owner.cookie).expect(200);

    await api(app, analyst).post('/workspaces', { name: 'Campaign Hub' }).expect(201);
    await api(app, analyst).get('/audit-logs').expect(403);

    const logs = await api(app, owner).get('/audit-logs').expect(200);
    expect(logs.body.data.map((l: { action: string }) => l.action)).toContain('member.role_changed');
  });

  it('removes members, who then lose access', async () => {
    const temp = await signUp(app, 'Temp');
    await inviteAndAccept(app, owner, temp, orgId, 'viewer');
    await api(app, temp).get('/workspaces').expect(200);
    await auth(app).post('/organization/remove-member', { memberIdOrEmail: temp.email, organizationId: orgId }, owner.cookie).expect(200);
    const res = await api(app, temp).get('/workspaces');
    expect([403]).toContain(res.status);
  });

  it('enforces the plan member limit on invitations', async () => {
    const solo = await signUp(app, 'Solo');
    const soloOrg = await createOrg(app, solo, 'Solo Org');
    // Leave the trial for Free (1 member).
    await api(app, solo).post('/billing/change-plan', { plan: 'FREE' }).expect(200);
    const friend = await signUp(app, 'Friend');
    const res = await auth(app).post('/organization/invite-member', { email: friend.email, role: 'viewer', organizationId: soloOrg }, solo.cookie);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');

    const usage = await api(app, solo).get('/billing/usage').expect(200);
    expect(usage.body.metrics).toContainEqual({ metric: 'members', used: 1, limit: 1 });
  });

  it('enforces the plan workspace limit', async () => {
    const u = await signUp(app, 'Limited');
    await createOrg(app, u, 'Limited Org');
    await api(app, u).post('/billing/change-plan', { plan: 'FREE' }).expect(200);
    const res = await api(app, u).post('/workspaces', { name: 'Second' }).expect(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { metric: 'workspaces', limit: 1, used: 1 } });
  });
});
