import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const ORIGIN = 'http://localhost:3000';
let counter = 0;

export interface TestUser {
  email: string;
  cookie: string;
  userId: string;
}

const extractCookie = (res: request.Response): string =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => c.split(';')[0]).join('; ');

/** Signs up a fresh user and returns its session cookie. */
export async function signUp(app: INestApplication, name = 'Test User'): Promise<TestUser> {
  const email = `user${Date.now()}${counter++}@example.com`;
  const res = await request(app.getHttpServer() as Server)
    .post('/api/auth/sign-up/email')
    .set('Origin', ORIGIN)
    .send({ name, email, password: 'supersecret123' })
    .expect(200);
  const userId = (res.body as { user: { id: string } }).user.id;
  // Mirrors a user who completed email verification (required e.g. to accept invitations).
  await app.get(PrismaService).system.user.update({ where: { id: userId }, data: { emailVerified: true } });
  return { email, cookie: extractCookie(res), userId };
}

/** Creates an organization via Better Auth (which also makes it the active organization). */
export async function createOrg(app: INestApplication, user: TestUser, name: string): Promise<string> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}${counter++}`;
  const res = await request(app.getHttpServer() as Server)
    .post('/api/auth/organization/create')
    .set('Origin', ORIGIN)
    .set('Cookie', user.cookie)
    .send({ name, slug })
    .expect(200);
  return (res.body as { id: string }).id;
}

export async function setActiveOrg(app: INestApplication, user: TestUser, organizationId: string): Promise<request.Response> {
  return request(app.getHttpServer() as Server)
    .post('/api/auth/organization/set-active')
    .set('Origin', ORIGIN)
    .set('Cookie', user.cookie)
    .send({ organizationId });
}

export const api = (app: INestApplication, user?: TestUser) => {
  const agent = request(app.getHttpServer() as Server);
  const wrap = (r: request.Test) => (user ? r.set('Cookie', user.cookie) : r).set('Origin', ORIGIN);
  return {
    get: (path: string) => wrap(agent.get(`/api/v1${path}`)),
    post: (path: string, body?: object) => wrap(agent.post(`/api/v1${path}`)).send(body ?? {}),
    patch: (path: string, body?: object) => wrap(agent.patch(`/api/v1${path}`)).send(body ?? {}),
    put: (path: string, body?: object) => wrap(agent.put(`/api/v1${path}`)).send(body ?? {}),
    delete: (path: string) => wrap(agent.delete(`/api/v1${path}`)),
  };
};

export interface CapturedEmailDto {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: string;
}

/** Polls the dev mailbox (emails are delivered asynchronously through BullMQ). */
export async function waitForEmail(app: INestApplication, to: string, tag: string, timeoutMs = 8000): Promise<CapturedEmailDto> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer() as Server).get('/api/v1/dev/emails').query({ to });
    const found = (res.body.emails as CapturedEmailDto[]).find((e) => e.tag === tag);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No "${tag}" email for ${to} within ${timeoutMs}ms`);
}

/** Extracts the first link from a captured email's text body. */
export const linkFrom = (email: CapturedEmailDto): string => {
  const m = email.text.match(/https?:\/\/\S+/);
  if (!m) throw new Error('No link in email');
  return m[0];
};

/** Turns a public web link (http://localhost:3000/api/...) into a path the test server can serve. */
export const pathOf = (url: string): string => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

export const cookieFrom = (res: request.Response): string =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => c.split(';')[0]).join('; ');

export const auth = (app: INestApplication) => {
  const agent = request(app.getHttpServer() as Server);
  return {
    post: (path: string, body: object, cookie?: string) => {
      const r = agent.post(`/api/auth${path}`).set('Origin', ORIGIN).send(body);
      return cookie ? r.set('Cookie', cookie) : r;
    },
    get: (path: string, cookie?: string) => {
      const r = agent.get(path.startsWith('/api/') ? path : `/api/auth${path}`).set('Origin', ORIGIN);
      return cookie ? r.set('Cookie', cookie) : r;
    },
  };
};

/** Adds an existing user to an organization through the real invitation flow. */
export async function inviteAndAccept(app: INestApplication, inviter: TestUser, invitee: TestUser, organizationId: string, role: string) {
  const inv = await auth(app).post('/organization/invite-member', { email: invitee.email, role, organizationId }, inviter.cookie);
  if (inv.status !== 200) throw new Error(`invite failed ${inv.status} ${JSON.stringify(inv.body)}`);
  const acc = await auth(app).post('/organization/accept-invitation', { invitationId: inv.body.id }, invitee.cookie);
  if (acc.status !== 200) throw new Error(`accept failed ${acc.status} ${JSON.stringify(acc.body)}`);
  await setActiveOrg(app, invitee, organizationId);
  return inv.body.id as string;
}
