import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.factory.js';
import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../src/billing/payment-provider.interface.js';
import { OBJECT_STORAGE, type ObjectHead, type ObjectStorage } from '../src/storage/object-storage.js';

/** In-memory object storage: tests "upload" by calling `put`. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly bucket = 'test-bucket';
  readonly objects = new Map<string, ObjectHead>();
  put(key: string, head: ObjectHead) {
    this.objects.set(key, head);
  }
  async presignPut(key: string) {
    return `https://storage.test/${key}?X-Amz-Signature=test`;
  }
  async presignGet(key: string) {
    return `https://storage.test/${key}?X-Amz-Signature=get`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
}

export interface TestAppOptions {
  env?: Record<string, string>;
  paymentProvider?: PaymentProvider;
  storage?: ObjectStorage;
}

/** Builds the real AppModule with selected providers overridden (env, payments, object storage). */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(loadEnv({ ...process.env, ...options.env }))
    .overrideProvider(OBJECT_STORAGE)
    .useValue(options.storage ?? new MemoryObjectStorage());
  if (options.paymentProvider) builder = builder.overrideProvider(PAYMENT_PROVIDER).useValue(options.paymentProvider);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return app;
}
