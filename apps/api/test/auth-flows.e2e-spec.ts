import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './harness.js';
import { api, auth, cookieFrom, createOrg, inviteAndAccept, linkFrom, pathOf, signUp, waitForEmail } from './helpers.js';

const PASSWORD = 'supersecret123';
const newEmail = () => `flow${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;

describe('Auth flows with email verification required (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ env: { REQUIRE_EMAIL_VERIFICATION: 'true' } });
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports enabled sign-in methods', async () => {
    const res = await api(app).get('/auth/providers').expect(200);
    expect(res.body).toEqual({ emailPassword: true, google: false, requireEmailVerification: true });
  });

  it('sends a verification email, blocks sign-in until verified, then signs in via the link', async () => {
    const email = newEmail();
    const signup = await auth(app).post('/sign-up/email', { name: 'Verify Me', email, password: PASSWORD }).expect(200);
    expect(signup.body.token).toBeNull();
    expect(cookieFrom(signup)).not.toContain('session_token');

    const blocked = await auth(app).post('/sign-in/email', { email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

    const mail = await waitForEmail(app, email, 'verify-email');
    expect(mail.subject).toMatch(/verify/i);
    const link = linkFrom(mail);
    expect(link.startsWith('http://localhost:3000/api/auth/verify-email?token=')).toBe(true);

    const verified = await auth(app).get(pathOf(link));
    expect([200, 302]).toContain(verified.status);
    const cookie = cookieFrom(verified);
    expect(cookie).toContain('zatma.session_token');

    const me = await api(app, { email, cookie, userId: '' }).get('/users/me').expect(200);
    expect(me.body.emailVerified).toBe(true);
    await auth(app).post('/sign-in/email', { email, password: PASSWORD }).expect(200);
  });

  it('rejects a tampered verification token', async () => {
    const res = await auth(app).get('/verify-email?token=not-a-real-token');
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(cookieFrom(res)).not.toContain('session_token=');
  });
});

describe('Password reset and account deletion (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('resets the password via emailed link and revokes existing sessions', async () => {
    const user = await signUp(app, 'Reset User');
    await auth(app).post('/request-password-reset', { email: user.email, redirectTo: '/reset-password' }).expect(200);

    const mail = await waitForEmail(app, user.email, 'reset-password');
    const link = linkFrom(mail);
    expect(link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\//);

    const redirect = await auth(app).get(pathOf(link)).expect(302);
    const token = new URL(redirect.headers.location as string, 'http://localhost:3000').searchParams.get('token');
    expect(token).toBeTruthy();

    await auth(app).post('/reset-password', { newPassword: 'brand-new-pass-42', token }).expect(200);
    await api(app, user).get('/users/me').expect(401); // old session revoked
    await auth(app).post('/sign-in/email', { email: user.email, password: PASSWORD }).expect(401);
    await auth(app).post('/sign-in/email', { email: user.email, password: 'brand-new-pass-42' }).expect(200);
    await auth(app).post('/reset-password', { newPassword: 'another-pass-42', token }).expect(400); // single use
  });

  it('does not reveal whether an email exists', async () => {
    const res = await auth(app).post('/request-password-reset', { email: newEmail(), redirectTo: '/reset-password' });
    expect(res.status).toBe(200);
  });

  it('blocks deleting the account of the sole owner of an organization with other members', async () => {
    const owner = await signUp(app, 'Sole Owner');
    const member = await signUp(app, 'Member');
    const orgId = await createOrg(app, owner, 'Owned Org');
    await inviteAndAccept(app, owner, member, orgId, 'viewer');

    const eligibility = await api(app, owner).get('/users/me/deletion-eligibility').expect(200);
    expect(eligibility.body.canDelete).toBe(false);
    expect(eligibility.body.blockingOrganizations).toEqual([{ id: orgId, name: 'Owned Org' }]);

    await auth(app).post('/delete-user', {}, owner.cookie).expect(200);
    const mail = await waitForEmail(app, owner.email, 'delete-account');
    const res = await auth(app).get(pathOf(linkFrom(mail)), owner.cookie);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('SOLE_OWNER');
    await api(app, owner).get('/users/me').expect(200);
  });

  it('deletes an account after email confirmation, removing organizations it alone belonged to', async () => {
    const user = await signUp(app, 'Leaving User');
    const orgId = await createOrg(app, user, 'Solo Org');
    expect((await api(app, user).get('/users/me/deletion-eligibility').expect(200)).body.canDelete).toBe(true);
    await auth(app).post('/delete-user', {}, user.cookie).expect(200);
    const mail = await waitForEmail(app, user.email, 'delete-account');
    await auth(app).get(pathOf(linkFrom(mail))).expect(404); // requires the user's own signed-in session
    const res = await auth(app).get(pathOf(linkFrom(mail)), user.cookie);
    expect(res.status).toBeLessThan(400);

    const prisma = app.get(PrismaService);
    expect(await prisma.system.user.findUnique({ where: { id: user.userId } })).toBeNull();
    expect(await prisma.system.organization.findUnique({ where: { id: orgId } })).toBeNull();
    expect(await prisma.system.workspace.count({ where: { organizationId: orgId } })).toBe(0);
  });
});
