import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignedUpload } from '@zatma/types';
import type { PresignUploadInput } from '@zatma/validation';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
const DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * S3-compatible object storage (MinIO in development, Cloudflare R2 in production).
 * Objects are private; access is always via short-lived presigned URLs.
 * Keys are namespaced by organization: org/<organizationId>/<purpose>/<uuid>.<ext>
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
  ) {
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  static buildKey(organizationId: string, purpose: string, mimeType: string, id: string = randomUUID()): string {
    return `org/${organizationId}/${purpose.toLowerCase()}/${id}.${EXTENSIONS[mimeType] ?? 'bin'}`;
  }

  async createUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    const organizationId = TenantContext.requireOrganizationId();
    const key = StorageService.buildKey(organizationId, input.purpose, input.mimeType);
    const file = await this.prisma.tenant.storedFile.create({
      data: {
        organizationId,
        uploadedById: TenantContext.get()?.userId ?? null,
        key,
        bucket: this.bucket,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        purpose: input.purpose,
      },
    });
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.mimeType, ContentLength: input.sizeBytes }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return {
      fileId: file.id,
      key,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  async createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  }
}
