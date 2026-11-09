import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, MemoryObjectStorage } from './harness.js';
import { api, createOrg, signUp, type TestUser } from './helpers.js';

describe('Uploads and organization logo (e2e)', () => {
  let app: NestExpressApplication;
  const storage = new MemoryObjectStorage();
  let owner: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await createTestApp({ storage });
    owner = await signUp(app, 'Logo Owner');
    other = await signUp(app, 'Other Org Owner');
    await createOrg(app, owner, 'Logo Org');
    await createOrg(app, other, 'Other Org');
  });
  afterAll(async () => {
    await app.close();
  });

  const presign = (user: TestUser, body: object) => api(app, user).post('/storage/uploads', body).expect(201);

  it('completes an upload only after the object exists with the declared size and type', async () => {
    const up = await presign(owner, { fileName: 'logo.png', mimeType: 'image/png', sizeBytes: 4096, purpose: 'LOGO' });
    const missing = await api(app, owner).post(`/storage/uploads/${up.body.fileId}/complete`).expect(409);
    expect(missing.body.code).toBe('UPLOAD_MISSING');

    storage.put(up.body.key, { sizeBytes: 9999, contentType: 'image/png' });
    expect((await api(app, owner).post(`/storage/uploads/${up.body.fileId}/complete`).expect(422)).body.code).toBe('UPLOAD_MISMATCH');

    storage.put(up.body.key, { sizeBytes: 4096, contentType: 'image/png' });
    const done = await api(app, owner).post(`/storage/uploads/${up.body.fileId}/complete`).expect(201);
    expect(done.body.status).toBe('UPLOADED');
  });

  it('sets the organization logo and returns a signed URL', async () => {
    const up = await presign(owner, { fileName: 'brand.png', mimeType: 'image/png', sizeBytes: 2048, purpose: 'LOGO' });
    storage.put(up.body.key, { sizeBytes: 2048, contentType: 'image/png' });
    await api(app, owner).post(`/storage/uploads/${up.body.fileId}/complete`).expect(201);

    const org = await api(app, owner).put('/organizations/current/logo', { fileId: up.body.fileId }).expect(200);
    expect(org.body.logo).toBe(up.body.fileId);
    expect(org.body.logoUrl).toContain(up.body.key);

    const url = await api(app, owner).get(`/files/${up.body.fileId}/url`).expect(200);
    expect(url.body.url).toContain('X-Amz-Signature');

    const removed = await api(app, owner).delete('/organizations/current/logo').expect(200);
    expect(removed.body.logoUrl).toBeNull();
  });

  it('rejects non-logo files and files from other organizations', async () => {
    const csv = await presign(owner, { fileName: 'leads.csv', mimeType: 'text/csv', sizeBytes: 100, purpose: 'IMPORT' });
    storage.put(csv.body.key, { sizeBytes: 100, contentType: 'text/csv' });
    await api(app, owner).post(`/storage/uploads/${csv.body.fileId}/complete`).expect(201);
    expect((await api(app, owner).put('/organizations/current/logo', { fileId: csv.body.fileId }).expect(422)).body.code).toBe('INVALID_LOGO');

    const foreign = await presign(other, { fileName: 'x.png', mimeType: 'image/png', sizeBytes: 10, purpose: 'LOGO' });
    storage.put(foreign.body.key, { sizeBytes: 10, contentType: 'image/png' });
    await api(app, other).post(`/storage/uploads/${foreign.body.fileId}/complete`).expect(201);

    await api(app, owner).put('/organizations/current/logo', { fileId: foreign.body.fileId }).expect(404);
    await api(app, owner).post(`/storage/uploads/${foreign.body.fileId}/complete`).expect(404);
    await api(app, owner).get(`/files/${foreign.body.fileId}/url`).expect(404);
  });

  it('enforces the storage limit of the plan', async () => {
    await api(app, other).post('/billing/change-plan', { plan: 'FREE' }).expect(200); // 500 MB
    const prisma = app.get(PrismaService);
    const { id: orgId } = (await api(app, other).get('/organizations/current').expect(200)).body as { id: string };
    await prisma.system.storedFile.create({
      data: { organizationId: orgId, key: `org/${orgId}/other/filler.bin`, bucket: 'test-bucket', fileName: 'filler', mimeType: 'video/mp4', sizeBytes: 495 * 1024 * 1024, purpose: 'OTHER', status: 'UPLOADED' },
    });
    await api(app, other).post('/storage/uploads', { fileName: 'small.png', mimeType: 'image/png', sizeBytes: 1024 }).expect(201);
    const res = await api(app, other).post('/storage/uploads', { fileName: 'big.mp4', mimeType: 'video/mp4', sizeBytes: 10 * 1024 * 1024 }).expect(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { metric: 'storageMb', limit: 500 } });
  });
});
