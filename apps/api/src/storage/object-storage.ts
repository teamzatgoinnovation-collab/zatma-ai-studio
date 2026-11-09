import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.js';

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

/** Narrow storage port so tests (and other backends) can replace S3. */
export interface ObjectStorage {
  readonly bucket: string;
  presignPut(key: string, contentType: string, sizeBytes: number, expiresInSeconds: number): Promise<string>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** S3-compatible implementation (an S3 emulator in development, Cloudflare R2 in production). */
export class S3ObjectStorage implements ObjectStorage {
  readonly bucket: string;
  private readonly s3: S3Client;

  constructor(env: Env) {
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  presignPut(key: string, contentType: string, sizeBytes: number, expiresIn: number): Promise<string> {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }), { expiresIn });
  }

  presignGet(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (err) {
      if (err instanceof NotFound || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }
}
