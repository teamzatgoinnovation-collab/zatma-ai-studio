import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';

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
  return { email, cookie: extractCookie(res), userId: (res.body as { user: { id: string } }).user.id };
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
    delete: (path: string) => wrap(agent.delete(`/api/v1${path}`)),
  };
};
