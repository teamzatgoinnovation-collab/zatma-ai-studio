import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PresignedUpload, StoredFileSummary } from '@zatma/types';
import type { PresignUploadInput } from '@zatma/validation';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { StoredFile } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../billing/usage.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
};

const UPLOAD_URL_TTL_SECONDS = 600;
export const DOWNLOAD_URL_TTL_SECONDS = 300;

const toSummary = (f: StoredFile): StoredFileSummary => ({
  id: f.id,
  fileName: f.fileName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  purpose: f.purpose,
  status: f.status,
});

/**
 * Private object storage with presigned URLs.
 * Keys are namespaced by organization: org/<organizationId>/<purpose>/<uuid>.<ext>
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  static buildKey(organizationId: string, purpose: string, mimeType: string, id: string = randomUUID()): string {
    return `org/${organizationId}/${purpose.toLowerCase()}/${id}.${EXTENSIONS[mimeType] ?? 'bin'}`;
  }

  async createUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    const organizationId = TenantContext.requireOrganizationId();
    await this.usage.assertWithinLimit(organizationId, 'storageMb', Math.ceil(input.sizeBytes / (1024 * 1024)));
    const key = StorageService.buildKey(organizationId, input.purpose, input.mimeType);
    const file = await this.prisma.tenant.storedFile.create({
      data: {
        organizationId,
        uploadedById: TenantContext.get()?.userId ?? null,
        key,
        bucket: this.storage.bucket,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        purpose: input.purpose,
      },
    });
    const uploadUrl = await this.storage.presignPut(key, input.mimeType, input.sizeBytes, UPLOAD_URL_TTL_SECONDS);
    return { fileId: file.id, key, uploadUrl, method: 'PUT', headers: { 'Content-Type': input.mimeType }, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /** Confirms the browser upload landed and matches what was declared. */
  async completeUpload(id: string): Promise<StoredFileSummary> {
    const file = await this.prisma.tenant.storedFile.findFirst({ where: { id } });
    if (!file) throw notFound('File');
    if (file.status === 'UPLOADED') return toSummary(file);
    const head = await this.storage.head(file.key);
    if (!head) throw new AppException(HttpStatus.CONFLICT, 'UPLOAD_MISSING', 'The file has not been uploaded yet');
    if (head.sizeBytes !== file.sizeBytes || (head.contentType && head.contentType !== file.mimeType)) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'UPLOAD_MISMATCH', 'The uploaded file does not match the declared size or type');
    }
    const updated = await this.prisma.tenant.storedFile.update({ where: { id }, data: { status: 'UPLOADED' } });
    return toSummary(updated);
  }

  /** Loads an uploaded file of the active organization (404 for other tenants). */
  async getUploaded(id: string): Promise<StoredFile> {
    const file = await this.prisma.tenant.storedFile.findFirst({ where: { id, status: 'UPLOADED' } });
    if (!file) throw notFound('File');
    return file;
  }

  /** Reads an uploaded file's bytes (server-side processing such as CSV import). */
  async readUploaded(id: string, maxBytes: number): Promise<{ file: StoredFile; body: Buffer }> {
    const file = await this.getUploaded(id);
    return { file, body: await this.storage.getObject(file.key, maxBytes) };
  }

  async downloadUrl(id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const file = await this.getUploaded(id);
    return { url: await this.storage.presignGet(file.key, DOWNLOAD_URL_TTL_SECONDS), expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  /** Stores server-generated content (e.g. AI images) for the active organization. Returns the file id. */
  async storeGenerated(body: Buffer, mimeType: string, purpose: 'AI_IMAGE', fileName: string): Promise<{ id: string; key: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const key = StorageService.buildKey(organizationId, purpose, mimeType);
    await this.storage.putObject(key, body, mimeType);
    const file = await this.prisma.tenant.storedFile.create({
      data: {
        organizationId,
        uploadedById: TenantContext.get()?.userId ?? null,
        key,
        bucket: this.storage.bucket,
        fileName,
        mimeType,
        sizeBytes: body.length,
        purpose,
        status: 'UPLOADED',
      },
    });
    return { id: file.id, key };
  }

  /** Signed URL for a file by id without a tenant context (e.g. org logo for its own members). */
  async signedUrlForKey(key: string): Promise<string> {
    return this.storage.presignGet(key, DOWNLOAD_URL_TTL_SECONDS);
  }
}
